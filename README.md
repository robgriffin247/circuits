cd /home/robgri/personal/circuits/web
npm run dev

The web app now uses [`web/movements.yml`](/home/robgri/personal/circuits/web/movements.yml) and [`web/routines.yml`](/home/robgri/personal/circuits/web/routines.yml) as the source of truth. Those files are imported directly into the app at build time, so Vercel deployments pick up YAML changes automatically when the `web/` app is rebuilt.
