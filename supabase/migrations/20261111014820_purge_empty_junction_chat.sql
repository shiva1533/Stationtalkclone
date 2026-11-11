/*
# Clear chat when a junction becomes empty

1. New Functions
- `purge_junction_chat_if_empty(p_junction_id uuid)`: deletes all messages for a junction
  only when no participant is currently active there. Reactions on those messages are
  removed automatically through the existing cascade.

2. Activity definition
- A participant is active when `left_at` is null and `last_heartbeat` is within the last 90 seconds,
  matching the presence timeout used by the app.

3. Security
- The function runs with definer rights so it can clear messages regardless of row policies,
  but it only ever deletes when the room has zero active participants.
- Execute is granted to the anon and authenticated roles because the app has no sign-in.

4. Notes
- Called when a user leaves a room and when a user joins a room, so chat from a room that
  emptied without a clean exit (closed tab, lost connection) is also cleared.
*/

CREATE OR REPLACE FUNCTION purge_junction_chat_if_empty(p_junction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM participants
    WHERE junction_id = p_junction_id
      AND left_at IS NULL
      AND last_heartbeat > now() - interval '90 seconds'
  ) THEN
    DELETE FROM messages WHERE junction_id = p_junction_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_junction_chat_if_empty(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_junction_chat_if_empty(uuid) TO anon, authenticated;
