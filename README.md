Firewall Wiki CF

What this is
- A static site on Cloudflare Pages
- API endpoints using Cloudflare Pages Functions
- Data stored in Cloudflare D1
- Attachments stored in Cloudflare R2

Login
- First login bootstraps admin/admin if there are no users.

Deploy

1) Create D1 database
Cloudflare Dashboard -> D1 -> Create

2) Put the database UUID in wrangler.toml
database_id must be the D1 UUID.

3) Apply schema to the D1 database (run on your PC)
Open PowerShell in the folder that contains schema.sql and wrangler.toml, then run:
wrangler login
wrangler d1 execute firewall_wiki_db --file=schema.sql --remote

4) Create R2 bucket
Cloudflare Dashboard -> R2 -> Create bucket
Bucket name must be: firewall-wiki-attachments

5) Bind D1 and R2 to the Pages project
Cloudflare Dashboard -> Workers & Pages -> your project -> Settings -> Functions -> Bindings
- D1 binding: variable DB, select your database
- R2 binding: variable ATTACHMENTS, select your bucket

6) Deploy
Connect the GitHub repo to Pages, or use direct upload.

Troubleshooting
- If Functions deploy fails with REPLACE_WITH_YOUR_D1_ID, the deployed wrangler.toml still has the placeholder.
- If /api/spaces returns 401, you are not logged in.
