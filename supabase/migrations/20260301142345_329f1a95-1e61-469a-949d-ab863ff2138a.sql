
-- 1. Message reactions table
CREATE TABLE public.message_reactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id, emoji)
);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view reactions in their conversations" ON public.message_reactions
FOR SELECT USING (
  message_id IN (
    SELECT m.id FROM public.messages m
    WHERE m.conversation_id IN (SELECT get_my_conversation_ids())
  )
);

CREATE POLICY "Users can add reactions" ON public.message_reactions
FOR INSERT WITH CHECK (
  user_id = auth.uid() AND
  message_id IN (
    SELECT m.id FROM public.messages m
    WHERE m.conversation_id IN (SELECT get_my_conversation_ids())
  )
);

CREATE POLICY "Users can remove own reactions" ON public.message_reactions
FOR DELETE USING (user_id = auth.uid());

-- 2. Notifications table
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  type TEXT NOT NULL DEFAULT 'message',
  title TEXT NOT NULL,
  body TEXT,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications" ON public.notifications
FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications" ON public.notifications
FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own notifications" ON public.notifications
FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "System can insert notifications" ON public.notifications
FOR INSERT WITH CHECK (true);

-- 3. Add group chat columns to conversations
ALTER TABLE public.conversations ADD COLUMN name TEXT;
ALTER TABLE public.conversations ADD COLUMN is_group BOOLEAN NOT NULL DEFAULT false;

-- 4. Enable realtime for reactions and notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- 5. Function to create a notification when a message is sent
CREATE OR REPLACE FUNCTION public.notify_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  participant RECORD;
  sender_name TEXT;
  conv_name TEXT;
BEGIN
  SELECT COALESCE(p.display_name, p.username, 'Someone') INTO sender_name
  FROM public.profiles p WHERE p.user_id = NEW.sender_id;

  SELECT c.name INTO conv_name FROM public.conversations c WHERE c.id = NEW.conversation_id;

  FOR participant IN
    SELECT cp.user_id FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id AND cp.user_id != NEW.sender_id
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, conversation_id)
    VALUES (
      participant.user_id,
      'message',
      sender_name,
      CASE
        WHEN NEW.message_type = 'text' THEN LEFT(NEW.content, 100)
        ELSE '📎 ' || NEW.message_type
      END,
      NEW.conversation_id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_message_insert_notify
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_message();

-- 6. Function to create group conversation
CREATE OR REPLACE FUNCTION public.create_group_conversation(group_name TEXT, member_ids UUID[])
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  new_conv_id uuid;
  member_id uuid;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversations (name, is_group) VALUES (group_name, true)
  RETURNING id INTO new_conv_id;

  -- Add creator
  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (new_conv_id, current_user_id);

  -- Add members
  FOREACH member_id IN ARRAY member_ids
  LOOP
    IF member_id != current_user_id THEN
      INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (new_conv_id, member_id);
    END IF;
  END LOOP;

  RETURN new_conv_id;
END;
$$;
