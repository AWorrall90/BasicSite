# Bar Stock

A phone-first web app for running bar stock-takes.

- **Opening stock**: count sealed units for each product. For opened bottles, take a photo and mark the liquid level (or let AI estimate it), or type a percentage.
- **Stock in**: photograph invoices or delivery notes. AI reads the lines (supplier, quantities, case sizes, prices) and matches them to your products. You check the lines, then save.
- **Stock out**: import the sales export (CSV) from your ePOS, or photograph a printed sales report. Till items are linked to products with an amount per sale, e.g. a 25ml measure from a 700ml bottle.
- **Closing stock & result**: count again. The report shows opening + deliveries − sales = expected stock, compares it with the count, and gives the variance in units, % and £ at cost. Closing a period carries the closing count over as the next opening count.

The app remembers how invoice descriptions and till item names map to products, so later imports need fewer corrections.

## Run it

```sh
cd bar-stock
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start     # http://localhost:3000
```

Without `ANTHROPIC_API_KEY` the app still works: photos are stored with each delivery, sales report and count, and you enter the figures by hand. The bottle-level tool works without AI too.

Optional settings: `PORT` (default 3000), `CLAUDE_MODEL` (default `claude-opus-5-5`) and `ACCESS_CODE` (if set, photo reading asks for this code once per device; you can change it under Settings).

### Put it online with an HTTPS link (Render)

The repo includes a `render.yaml` blueprint.

1. Sign up at https://render.com with your GitHub account.
2. Click **New → Blueprint** and choose this repository. Pick the branch that holds `render.yaml` (`master` once the app is merged).
3. Render asks for two values:
   - `ANTHROPIC_API_KEY`: your key from https://console.anthropic.com
   - `ACCESS_CODE`: any code you choose. Phones must enter it once before photo reading works, so strangers who find the link can't spend your API credit.
4. Click **Apply**. After a few minutes the service shows an address such as `https://bar-stock-xxxx.onrender.com`.

On the free plan the server sleeps after about 15 minutes of no use, so the first load after that takes up to a minute. Your stock data is unaffected, because it is stored on the phone. Every push to the branch deploys again automatically.

### On an iPhone

1. Run the server on a computer on the same Wi-Fi as the phone (see above).
2. Find the computer's local IP address: on a Mac, System Settings → Wi-Fi → Details; on Windows, run `ipconfig`.
3. In Safari on the iPhone, open `http://<that-ip>:3000`. The camera, photo reading and storage all work over plain HTTP.
4. Optional: tap Share → **Add to Home Screen** to open it full-screen like an app.

For use away from that Wi-Fi, and for offline use in a cellar with no signal, host it on an HTTPS service such as Render, Railway or Fly.io. Set `ANTHROPIC_API_KEY` there, then open the HTTPS address in Safari and add it to the Home Screen.

Data is stored in Safari on that phone. Safari can clear the storage of a site that isn't added to the Home Screen and hasn't been used for a few weeks, so add it to the Home Screen and export backups.

## How it works

| Part | Where |
| --- | --- |
| Server: static files plus `/api/read/{invoice,sales,bottle}` | `server.js` |
| Photo reading with Claude, using structured JSON output | `lib/vision.js` |
| Stock maths, CSV parsing, name matching (no DOM, unit tested) | `public/js/core.js` |
| Screens | `public/js/app.js` |
| Bottle-level tool | `public/js/bottle.js` |
| On-device storage (IndexedDB) | `public/js/db.js` |

Data is stored **in the browser on each device**. Use Settings → Export backup regularly. Photos are not included in the backup. The API key stays on the server and is never sent to the browser.

How the bottle estimate works: you mark where a full bottle fills to, the current liquid level, and the bottom. The fraction is measured by height between those marks. That is accurate for the straight body of a bottle, but less so in the neck and shoulder. The AI estimate takes the bottle's shape into account and places the level marker, which you can then adjust.

## Tests

```sh
npm test
```

## Ideas for later

- A shared database and logins, so several staff and devices can work on the same stock-take
- Direct ePOS integrations (Square, Lightspeed, Zettle) in place of CSV export
- Selling prices, GP % and par levels for ordering
- Weighing bottles on scales as an alternative to photos
