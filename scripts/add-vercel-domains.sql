-- Paste into Supabase SQL Editor (project rvderruwwpssegttzktf) and click Run.
-- Registers every stable Vercel URL for the FahTalay hotel so they stop showing
-- "ไม่พบโรงแรมสำหรับโดเมนนี้". Safe to run more than once.
INSERT INTO tenant_domains (host, tenant_id)
SELECT h, t.id
FROM tenants t,
     unnest(ARRAY['mu-beryl-23.vercel.app', 'sommao.vercel.app', 'git-main-sommao.vercel.app']) AS h
WHERE t.slug = 'fahtalay'
ON CONFLICT (host) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

-- Check: should list all three hosts
SELECT d.host, t.name FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id ORDER BY d.host;
