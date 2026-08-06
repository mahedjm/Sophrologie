// =========================================================
// Configuration Supabase
// À remplir depuis : Dashboard Supabase > Project Settings > API
// -----------------------------------------------------------
// SUPABASE_URL       -> "Project URL"
// SUPABASE_ANON_KEY  -> "anon public" key (PAS la clé service_role,
//                        celle-ci doit rester secrète côté serveur)
// =========================================================

const SUPABASE_URL = 'https://jtvztegdisffntldrkqc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_S_HgrBMSBe51eShESnDuXw_EVwKgO_h';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Jours à bloquer manuellement (vacances, absences), format 'YYYY-MM-DD'.
// Ex : window.CLOSED_DATES = ['2026-08-15', '2026-08-16'];
window.CLOSED_DATES = [];
