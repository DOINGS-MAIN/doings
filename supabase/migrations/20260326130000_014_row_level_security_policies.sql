-- Migration 014: Row-Level Security Policies
-- ================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monnify_reserved_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spray_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.giveaways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.giveaway_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT TO authenticated
  USING (auth_id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "Admins can view all users"
  ON public.users FOR SELECT TO authenticated
  USING (public.is_any_admin(auth.uid()));

CREATE POLICY "Admins can update users"
  ON public.users FOR UPDATE TO authenticated
  USING (public.is_any_admin(auth.uid()));

CREATE POLICY "Users can view own wallets"
  ON public.wallets FOR SELECT TO authenticated
  USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Admins can view all wallets"
  ON public.wallets FOR SELECT TO authenticated
  USING (public.is_any_admin(auth.uid()));

CREATE POLICY "Users can view own transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Admins can view all transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (public.is_any_admin(auth.uid()));

CREATE POLICY "Users can manage own bank accounts"
  ON public.bank_accounts FOR ALL TO authenticated
  USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()))
  WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Anyone can view non-private events"
  ON public.events FOR SELECT TO authenticated
  USING (
    is_private = false
    OR host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
  );

CREATE POLICY "Users can create events"
  ON public.events FOR INSERT TO authenticated
  WITH CHECK (host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Hosts can update own events"
  ON public.events FOR UPDATE TO authenticated
  USING (host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Admins can manage all events"
  ON public.events FOR ALL TO authenticated
  USING (public.is_any_admin(auth.uid()));

CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can view active giveaways"
  ON public.giveaways FOR SELECT TO authenticated
  USING (
    status = 'active'
    OR creator_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
  );

CREATE POLICY "Users can create giveaways"
  ON public.giveaways FOR INSERT TO authenticated
  WITH CHECK (creator_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Super admins can manage admin roles"
  ON public.admin_roles FOR ALL TO authenticated
  USING (public.has_admin_role(auth.uid(), 'super_admin'));

CREATE POLICY "Admins can view own role"
  ON public.admin_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can view own kyc records"
  ON public.kyc_verifications FOR SELECT TO authenticated
  USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own kyc records"
  ON public.kyc_verifications FOR INSERT TO authenticated
  WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));
