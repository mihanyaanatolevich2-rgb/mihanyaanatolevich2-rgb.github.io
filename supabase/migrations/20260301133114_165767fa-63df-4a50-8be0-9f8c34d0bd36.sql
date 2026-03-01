
-- Tighten conversation_participants INSERT - allow adding self or adding others to conversations you're in
DROP POLICY IF EXISTS "Users can add participants to new conversations" ON conversation_participants;
CREATE POLICY "Users can add participants to new conversations"
ON conversation_participants FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() OR conversation_id IN (SELECT public.get_my_conversation_ids()));

-- Tighten conversations INSERT - any authenticated user can create
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON conversations;
CREATE POLICY "Authenticated users can create conversations"
ON conversations FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);
