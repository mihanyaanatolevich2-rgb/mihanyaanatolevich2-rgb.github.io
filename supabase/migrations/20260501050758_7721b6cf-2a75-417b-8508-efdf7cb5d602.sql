-- Add created_by and avatar_url to conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- Group admins table
CREATE TABLE IF NOT EXISTS public.group_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

ALTER TABLE public.group_admins ENABLE ROW LEVEL SECURITY;

-- Security definer helper to check admin without recursion
CREATE OR REPLACE FUNCTION public.is_group_admin(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_admins
    WHERE conversation_id = _conversation_id AND user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = _conversation_id AND created_by = _user_id
  );
$$;

-- RLS for group_admins
CREATE POLICY "Participants can view group admins"
  ON public.group_admins FOR SELECT
  TO authenticated
  USING (conversation_id IN (SELECT public.get_my_conversation_ids()));

CREATE POLICY "Admins can grant admin rights"
  ON public.group_admins FOR INSERT
  TO authenticated
  WITH CHECK (public.is_group_admin(conversation_id, auth.uid()));

CREATE POLICY "Admins can revoke admin rights"
  ON public.group_admins FOR DELETE
  TO authenticated
  USING (public.is_group_admin(conversation_id, auth.uid()));

-- Allow admins to UPDATE conversations (name, avatar_url)
DROP POLICY IF EXISTS "Admins can update group" ON public.conversations;
CREATE POLICY "Admins can update group"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (
    is_group = true AND public.is_group_admin(id, auth.uid())
  )
  WITH CHECK (
    is_group = true AND public.is_group_admin(id, auth.uid())
  );

-- Update create_group_conversation to set created_by and add creator as admin
CREATE OR REPLACE FUNCTION public.create_group_conversation(group_name text, member_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  new_conv_id uuid;
  member_id uuid;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversations (name, is_group, created_by)
  VALUES (group_name, true, current_user_id)
  RETURNING id INTO new_conv_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (new_conv_id, current_user_id);

  INSERT INTO public.group_admins (conversation_id, user_id, granted_by)
  VALUES (new_conv_id, current_user_id, current_user_id);

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

-- Backfill: existing groups without created_by get the earliest participant as creator+admin
DO $$
DECLARE
  conv RECORD;
  first_user uuid;
BEGIN
  FOR conv IN SELECT id FROM public.conversations WHERE is_group = true AND created_by IS NULL LOOP
    SELECT user_id INTO first_user
    FROM public.conversation_participants
    WHERE conversation_id = conv.id
    ORDER BY joined_at ASC
    LIMIT 1;
    IF first_user IS NOT NULL THEN
      UPDATE public.conversations SET created_by = first_user WHERE id = conv.id;
      INSERT INTO public.group_admins (conversation_id, user_id, granted_by)
      VALUES (conv.id, first_user, first_user)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;