
-- Fix: Only allow the trigger function (running as SECURITY DEFINER) to insert notifications
-- Drop the permissive policy and replace with a restrictive one
DROP POLICY "System can insert notifications" ON public.notifications;
CREATE POLICY "Only system can insert notifications" ON public.notifications
FOR INSERT WITH CHECK (false);
