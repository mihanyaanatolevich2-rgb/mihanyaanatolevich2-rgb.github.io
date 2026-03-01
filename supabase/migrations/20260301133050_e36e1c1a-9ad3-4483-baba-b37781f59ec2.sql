
-- Drop all existing policies on conversation_participants
DROP POLICY IF EXISTS "Users can view participants of their conversations" ON conversation_participants;
DROP POLICY IF EXISTS "Users can add participants to new conversations" ON conversation_participants;

-- Fix SELECT: use direct auth.uid() check, no self-referencing subquery
CREATE POLICY "Users can view participants of their conversations"
ON conversation_participants FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR conversation_id IN (
  SELECT cp.conversation_id FROM conversation_participants cp WHERE cp.user_id = auth.uid()
));

-- Actually the above still recurses. Use a simpler approach:
-- Drop it again
DROP POLICY IF EXISTS "Users can view participants of their conversations" ON conversation_participants;

-- Simple: user can see any row where they are a participant in that conversation
-- We check directly: does a row exist with this conversation_id and auth.uid()
CREATE POLICY "Users can view participants of their conversations"
ON conversation_participants FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = conversation_participants.conversation_id
    AND cp.user_id = auth.uid()
  )
);
