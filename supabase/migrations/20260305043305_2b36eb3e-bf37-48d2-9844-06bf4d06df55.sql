
-- Fix profiles RLS: restrict SELECT to only see profiles of users in your conversations or yourself
DROP POLICY IF EXISTS "Profiles viewable by authenticated users" ON public.profiles;

CREATE POLICY "Users can view relevant profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR user_id IN (
    SELECT DISTINCT cp.user_id
    FROM conversation_participants cp
    WHERE cp.conversation_id IN (SELECT get_my_conversation_ids())
  )
);
