
-- Add last_seen to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamp with time zone DEFAULT now();

-- Create message_read_by table for read receipts
CREATE TABLE IF NOT EXISTS public.message_read_by (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  read_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id)
);

ALTER TABLE public.message_read_by ENABLE ROW LEVEL SECURITY;

-- Users can see read receipts for messages in their conversations
CREATE POLICY "Users can view read receipts in their conversations"
ON public.message_read_by
FOR SELECT
TO authenticated
USING (
  message_id IN (
    SELECT m.id FROM messages m
    WHERE m.conversation_id IN (SELECT get_my_conversation_ids())
  )
);

-- Users can mark messages as read
CREATE POLICY "Users can mark messages as read"
ON public.message_read_by
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Enable realtime for message_read_by
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_read_by;

-- Function to update last_seen
CREATE OR REPLACE FUNCTION public.update_last_seen()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.profiles SET last_seen_at = now() WHERE user_id = auth.uid();
$$;
