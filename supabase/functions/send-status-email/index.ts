// =========================================================
// send-status-email
// -----------------------------------------------------------
// Appelée depuis admin.html quand la sophrologue clique sur
// "Confirmer" ou "Refuser". Vérifie qu'elle est bien connectée,
// met à jour le statut de la réservation, puis envoie un email
// au client pour l'informer de la décision.
//
// Body attendu : { "id": "<uuid réservation>", "statut": "confirme" | "refuse" }
//
// Secrets requis (Dashboard > Edge Functions > Secrets) :
//   SUPABASE_URL              -> déjà fourni automatiquement par Supabase
//   SUPABASE_SERVICE_ROLE_KEY -> clé service_role (jamais exposée au front)
//   RESEND_API_KEY            -> clé API Resend
//   FROM_EMAIL                -> adresse d'expédition validée sur Resend
// =========================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Vérifie que l'appelant est bien authentifiée (la sophrologue) —
    // refuse toute tentative venant d'un client anonyme du site public.
    const { data: userData, error: authError } = await admin.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: 'Non autorisé' }), { status: 401 });
    }

    const { id, statut } = await req.json();
    if (!id || !['confirme', 'refuse'].includes(statut)) {
      return new Response(JSON.stringify({ ok: false, error: 'Paramètres invalides' }), { status: 400 });
    }

    const { data: reservation, error: updateError } = await admin
      .from('reservations')
      .update({ statut })
      .eq('id', id)
      .select()
      .single();

    if (updateError || !reservation) {
      return new Response(JSON.stringify({ ok: false, error: updateError?.message }), { status: 500 });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev';

    const subject = statut === 'confirme'
      ? `Votre séance du ${reservation.date_seance} est confirmée`
      : `À propos de votre demande du ${reservation.date_seance}`;

    const html = statut === 'confirme'
      ? `<p>Bonjour ${reservation.prenom},</p>
         <p>Votre séance de <strong>${reservation.prestation}</strong> (${reservation.lieu})
         est confirmée le <strong>${reservation.date_seance} à ${reservation.heure_seance}</strong>.</p>
         <p>À bientôt.</p>`
      : `<p>Bonjour ${reservation.prenom},</p>
         <p>Je ne suis malheureusement pas en mesure de vous recevoir le
         ${reservation.date_seance} à ${reservation.heure_seance}. N'hésitez pas à
         choisir un autre créneau sur le site.</p>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromEmail, to: reservation.email, subject, html }),
    });

    return new Response(JSON.stringify({ ok: true, reservation }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
