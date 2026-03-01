
-- Create a security definer function to get user's conversation IDs without RLS
CREATE OR REPLACE FUNCTION public.get_my_conversation_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT conversation_id FROM conversation_participants WHERE user_id = auth.uid();
$$;

-- Fix conversation_participants SELECT policy
DROP POLICY IF EXISTS "Users can view participants of their conversations" ON conversation_participants;
CREATE POLICY "Users can view participants of their conversations"
ON conversation_participants FOR SELECT
TO authenticated
USING (conversation_id IN (SELECT public.get_my_conversation_ids()));

-- Fix INSERT policy
CREATE POLICY "Users can add participants to new conversations"
ON conversation_participants FOR INSERT
TO authenticated
WITH CHECK (true);

-- Fix conversations SELECT policy (also references conversation_participants)
DROP POLICY IF EXISTS "Users can view their conversations" ON conversations;
CREATE POLICY "Users can view their conversations"
ON conversations FOR SELECT
TO authenticated
USING (id IN (SELECT public.get_my_conversation_ids()));

-- Fix conversations INSERT policy
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON conversations;
CREATE POLICY "Authenticated users can create conversations"
ON conversations FOR INSERT
TO authenticated
WITH CHECK (true);

-- Fix messages SELECT policy
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
CREATE POLICY "Users can view messages in their conversations"
ON messages FOR SELECT
TO authenticated
USING (conversation_id IN (SELECT public.get_my_conversation_ids()));

-- Fix messages INSERT policy
DROP POLICY IF EXISTS "Users can send messages to their conversations" ON messages;
CREATE POLICY "Users can send messages to their conversations"
ON messages FOR INSERT
TO authenticated
WITH CHECK (sender_id = auth.uid() AND conversation_id IN (SELECT public.get_my_conversation_ids()));
