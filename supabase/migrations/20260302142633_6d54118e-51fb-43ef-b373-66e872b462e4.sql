
-- 1. Add edited/deleted columns to messages
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_edited boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_for_all boolean NOT NULL DEFAULT false;

-- 2. Table for "delete for me" 
CREATE TABLE IF NOT EXISTS public.deleted_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id)
);
ALTER TABLE public.deleted_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see own deleted" ON public.deleted_messages FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can delete for self" ON public.deleted_messages FOR INSERT WITH CHECK (user_id = auth.uid());

-- 3. Contact nicknames table
CREATE TABLE IF NOT EXISTS public.contact_nicknames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  contact_user_id uuid NOT NULL,
  nickname text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, contact_user_id)
);
ALTER TABLE public.contact_nicknames ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own nicknames" ON public.contact_nicknames FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 4. Add last_read_at to conversation_participants for unread counting
ALTER TABLE public.conversation_participants ADD COLUMN IF NOT EXISTS last_read_at timestamptz DEFAULT now();

-- 5. Allow UPDATE on messages for editing + soft delete
CREATE POLICY "Users can edit own messages" ON public.messages FOR UPDATE USING (sender_id = auth.uid());

-- 6. Allow DELETE on messages for own messages  
CREATE POLICY "Users can delete own messages" ON public.messages FOR DELETE USING (sender_id = auth.uid());

-- 7. Allow UPDATE on conversation_participants for last_read_at
CREATE POLICY "Users can update own participation" ON public.conversation_participants FOR UPDATE USING (user_id = auth.uid());

-- 8. Enable realtime for deleted_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.deleted_messages;
