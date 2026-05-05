-- Hidden conversations: each user can hide a chat from their own list
CREATE TABLE public.hidden_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  last_message_at_when_hidden timestamptz,
  UNIQUE(user_id, conversation_id)
);

ALTER TABLE public.hidden_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own hides"
ON public.hidden_conversations
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Allow group admins to remove participants (kick)
CREATE POLICY "Admins can remove participants"
ON public.conversation_participants
FOR DELETE
TO authenticated
USING (
  public.is_group_admin(conversation_id, auth.uid())
  AND user_id != auth.uid()  -- can't kick yourself via this policy
);

-- Allow users to leave conversations themselves
CREATE POLICY "Users can leave conversations"
ON public.conversation_participants
FOR DELETE
TO authenticated
USING (user_id = auth.uid());
