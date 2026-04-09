
CREATE TABLE public.pinned_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  pinned_by uuid NOT NULL,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, message_id)
);

ALTER TABLE public.pinned_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view pins in their conversations" ON public.pinned_messages
  FOR SELECT TO authenticated
  USING (conversation_id IN (SELECT get_my_conversation_ids()));

CREATE POLICY "Users can pin messages" ON public.pinned_messages
  FOR INSERT TO authenticated
  WITH CHECK (pinned_by = auth.uid() AND conversation_id IN (SELECT get_my_conversation_ids()));

CREATE POLICY "Users can unpin messages" ON public.pinned_messages
  FOR DELETE TO authenticated
  USING (conversation_id IN (SELECT get_my_conversation_ids()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.pinned_messages;
