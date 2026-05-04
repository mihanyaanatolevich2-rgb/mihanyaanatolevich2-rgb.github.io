ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS is_channel boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS channel_visibility text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_channel_visibility_check'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_channel_visibility_check
      CHECK (channel_visibility IS NULL OR channel_visibility IN ('public', 'private'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_public_channels
ON public.conversations (is_channel, channel_visibility, created_at DESC)
WHERE is_channel = true AND channel_visibility = 'public';

CREATE TABLE IF NOT EXISTS public.channel_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.channel_comments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_channel_comments_message_created
ON public.channel_comments (message_id, created_at ASC);

CREATE OR REPLACE FUNCTION public.can_post_in_conversation(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = _conversation_id
      AND (
        c.is_channel = false
        OR c.created_by = _user_id
        OR public.is_group_admin(c.id, _user_id)
      )
  );
$$;

DROP POLICY IF EXISTS "Users can send messages to their conversations" ON public.messages;
CREATE POLICY "Users can send messages to their conversations"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND conversation_id IN (SELECT public.get_my_conversation_ids())
  AND public.can_post_in_conversation(conversation_id, auth.uid())
);

DROP POLICY IF EXISTS "Public channels can be viewed by authenticated users" ON public.conversations;
CREATE POLICY "Public channels can be viewed by authenticated users"
ON public.conversations
FOR SELECT
TO authenticated
USING (is_channel = true AND channel_visibility = 'public');

DROP POLICY IF EXISTS "Channel participants can view comments" ON public.channel_comments;
CREATE POLICY "Channel participants can view comments"
ON public.channel_comments
FOR SELECT
TO authenticated
USING (conversation_id IN (SELECT public.get_my_conversation_ids()));

DROP POLICY IF EXISTS "Channel participants can add comments" ON public.channel_comments;
CREATE POLICY "Channel participants can add comments"
ON public.channel_comments
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND conversation_id IN (SELECT public.get_my_conversation_ids())
  AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_id
      AND m.conversation_id = channel_comments.conversation_id
      AND m.deleted_for_all = false
  )
);

DROP POLICY IF EXISTS "Users can edit own channel comments" ON public.channel_comments;
CREATE POLICY "Users can edit own channel comments"
ON public.channel_comments
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own channel comments" ON public.channel_comments;
CREATE POLICY "Users can delete own channel comments"
ON public.channel_comments
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

CREATE TRIGGER update_channel_comments_updated_at
BEFORE UPDATE ON public.channel_comments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.create_channel_conversation(
  channel_name text,
  channel_visibility text,
  member_ids uuid[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  new_conv_id uuid;
  member_id uuid;
  safe_visibility text := COALESCE(NULLIF(channel_visibility, ''), 'public');
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF length(trim(channel_name)) < 2 THEN
    RAISE EXCEPTION 'Channel name is too short' USING ERRCODE = '22023';
  END IF;

  IF safe_visibility NOT IN ('public', 'private') THEN
    RAISE EXCEPTION 'Invalid channel visibility' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.conversations (name, is_group, is_channel, channel_visibility, created_by)
  VALUES (trim(channel_name), true, true, safe_visibility, current_user_id)
  RETURNING id INTO new_conv_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (new_conv_id, current_user_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.group_admins (conversation_id, user_id, granted_by)
  VALUES (new_conv_id, current_user_id, current_user_id)
  ON CONFLICT DO NOTHING;

  FOREACH member_id IN ARRAY COALESCE(member_ids, '{}')
  LOOP
    IF member_id IS NOT NULL AND member_id != current_user_id THEN
      INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (new_conv_id, member_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RETURN new_conv_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_public_channels(search_term text DEFAULT '')
RETURNS TABLE(id uuid, name text, avatar_url text, members_count bigint, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.name,
    c.avatar_url,
    COUNT(cp.user_id) AS members_count,
    c.created_at
  FROM public.conversations c
  LEFT JOIN public.conversation_participants cp ON cp.conversation_id = c.id
  WHERE c.is_channel = true
    AND c.channel_visibility = 'public'
    AND (
      COALESCE(search_term, '') = ''
      OR c.name ILIKE '%' || search_term || '%'
    )
  GROUP BY c.id, c.name, c.avatar_url, c.created_at
  ORDER BY c.created_at DESC
  LIMIT 30;
$$;

CREATE OR REPLACE FUNCTION public.join_public_channel(channel_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = channel_id
      AND c.is_channel = true
      AND c.channel_visibility = 'public'
  ) THEN
    RAISE EXCEPTION 'Public channel not found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (channel_id, current_user_id)
  ON CONFLICT DO NOTHING;

  RETURN channel_id;
END;
$$;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_comments;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;