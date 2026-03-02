
Firewall Wiki CF - COMPLETE BUILD

Deployment Steps:

1. Create D1 database in Cloudflare.
2. Replace database_id in wrangler.toml.
3. Run:
   wrangler d1 execute firewall_wiki_db --file=./schema.sql
4. Create R2 bucket named firewall-wiki-attachments.
5. Deploy this folder to Cloudflare Pages.

Admin bootstrap:
INSERT INTO users (username,password_hash,role)
VALUES ('admin','admin','admin');

This package contains:
- D1 schema
- Spaces
- Pages
- Version foundation
- Comments
- Reactions
- Tasks
- Notifications
- Audit
- Attachments (R2 ready)
