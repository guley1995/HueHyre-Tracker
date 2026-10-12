-- HueHYRE Tracker – Storage-Buckets (nur auf Supabase vorhanden).
--   cvs:     CVs und Profil-PDFs, ein Ordner je K-Nummer (cvs/K-2026-065/…)
--   exports: nächtlicher Export (exports/2026-10-12/…)

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets fehlt – Storage-Migration übersprungen (lokale Testdatenbank).';
    return;
  end if;

  insert into storage.buckets (id, name, public) values ('cvs', 'cvs', false)
  on conflict (id) do nothing;
  insert into storage.buckets (id, name, public) values ('exports', 'exports', false)
  on conflict (id) do nothing;

  execute $p$create policy "cvs_app_all" on storage.objects for all to authenticated
    using (bucket_id = 'cvs') with check (bucket_id = 'cvs')$p$;
  execute $p$create policy "exports_app_read" on storage.objects for select to authenticated
    using (bucket_id = 'exports')$p$;
end $$;
