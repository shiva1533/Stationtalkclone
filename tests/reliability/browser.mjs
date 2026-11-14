import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function startBrowser() {
  const directory = await mkdtemp(join(tmpdir(), 'junction-reliability-'));
  const executable = process.env.CHROME_PATH ?? (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
  const chrome = spawn(executable, [
    '--headless=new', '--remote-debugging-port=0', '--no-first-run',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + join(directory, 'profile'),
    'about:blank',
  ], { windowsHide: true });
  const debug = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Chrome startup timed out')), 12000);
    chrome.on('error', reject);
    chrome.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve({ url: match[1], port: match[2] }); }
    });
  });
  const connections = [];
  async function connect(url) {
    const socket = new WebSocket(url);
    connections.push(socket);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let next = 0;
    const pending = new Map();
    const errors = [];
    socket.addEventListener('message', ({ data }) => {
      const response = JSON.parse(data);
      if (response.method === 'Runtime.exceptionThrown') errors.push(response.params.exceptionDetails.exception?.description ?? response.params.exceptionDetails.text);
      const operation = pending.get(response.id);
      if (!operation) return;
      pending.delete(response.id);
      if (response.error) operation.reject(new Error(JSON.stringify(response.error)));
      else operation.resolve(response.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const run = async (expression) => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    };
    const until = async (expression, timeout = 15000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await run('Boolean(' + expression + ')')) return;
        await delay(100);
      }
      throw new Error('Timed out: ' + expression + '\n' + await run('JSON.stringify(window.__testPeers?.map(peer=>({remote:peer.__testRemote,instance:peer.__testInstance,connection:peer.connectionState,ice:peer.iceConnectionState,signaling:peer.signalingState})))') + '\n' + await run('document.body.innerText.slice(0,2000)'));
    };
    const click = async (label) => {
      const selector = `[...document.querySelectorAll('button,summary')].find(e=>e.getClientRects().length && !e.disabled && (e.getAttribute('aria-label')===${JSON.stringify(label)} || e.textContent.trim().replace(/\\s+/g,' ')===${JSON.stringify(label)}))`;
      await until(selector);
      await run(selector + '.click()');
    };
    const input = (selector, value) => run(`(() => {
      const element=document.querySelector(${JSON.stringify(selector)});
      const prototype=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,${JSON.stringify(value)});
      element.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    const viewport = async (width, height = 844) => {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await delay(100);
    };
    const capture = async (name) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const path = join(directory, name + '.png');
      await writeFile(path, Buffer.from(data, 'base64'));
      console.log(path);
    };
    return { send, run, until, click, input, viewport, capture, errors };
  }
  const browser = await connect(debug.url);
  async function page(contextId) {
    const context = contextId ?? (await browser.send('Target.createBrowserContext')).browserContextId;
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
    const targets = await fetch('http://127.0.0.1:' + debug.port + '/json/list').then((response) => response.json());
    const client = await connect(targets.find(({ id }) => id === targetId).webSocketDebuggerUrl);
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__testPeers=[];
      window.__testStreams=[];
      window.__testMicrophoneRequests=0;
      const NativePeer=window.RTCPeerConnection;
      window.RTCPeerConnection=class extends NativePeer {
        constructor(...args){super(...args);window.__testPeers.push(this)}
      };
      const getUserMedia=navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
      if(getUserMedia) navigator.mediaDevices.getUserMedia=async(...args)=>{
        window.__testMicrophoneRequests++;
        const stream=await getUserMedia(...args);
        window.__testStreams.push(stream);
        return stream;
      };
      const play=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(){
        return window.__testBlockPlayback?Promise.reject(new DOMException('Test autoplay interruption','NotAllowedError')):play.call(this);
      };
    ` });
    return { ...client, contextId: context, targetId };
  }
  return {
    page, browser, directory,
    close: () => { connections.forEach((socket) => socket.close()); chrome.kill(); },
  };
}
