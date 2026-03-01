
-- Fix overly permissive policies
DROP POLICY "Authenticated users can create conversations" ON public.conversations;
CREATE POLICY "Authenticated users can create conversations" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (
    id IN (SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid())
    OR NOT EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = id)
  );

DROP POLICY "Authenticated users can add participants" ON public.conversation_participants;
CREATE POLICY "Users can add participants to new conversations" ON public.conversation_participants FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() 
    OR conversation_id IN (SELECT conversation_id FROM public.conversation_participants cp WHERE cp.user_id = auth.uid())
  );
