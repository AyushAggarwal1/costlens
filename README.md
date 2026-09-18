# Cost Ledger — raw OpenCost data in a UI

A small Node + React app that shows what the OpenCost API returns, using OpenCost's own field names. Nothing is mapped, joined or scored in the UI.

| View | Endpoint | What it shows |
|---|---|---|
| Overview | `/allocation` | Sums of `totalCost`, `cpuCost`, `ramCost`, `pvCost`… over the window, trend per day, `totalCost` by namespace and controllerKind, the `__idle__` row |
| Allocation | `/allocation` | Rows per cluster, namespace or controller with `cpuCoreRequestAverage`, `cpuCoreUsageAverage`, `cpuEfficiency`, `ramByte…`, `pvBytes`, network bytes and every cost field; click a controller to see its full OpenCost record |
| Assets | `/assets` | Node, Disk, LoadBalancer and ClusterManagement records with capacity, hours, breakdowns and cost |
| Cloud costs | `/cloudCost` | Billing lines grouped by provider, invoiceEntityID, accountID, service, category or providerID, for any of the five cost figures |
| Utilization | `/allocation` with `step` | Usage vs request over time and per controller |
| Raw query | any | Run an arbitrary query and read, copy or download the JSON response |

## Run it

```bash
export KUBECONFIG=/home/ayush/Desktop/kubeconfig/test.yaml
kubectl -n opencost port-forward deployment/opencost 9003:9003 &
npm install
npm run build && npm start        # http://localhost:8080
# or, with hot reload for the UI:
npm run dev                       # UI on http://localhost:5173, API on 8080
```

Environment: `OPENCOST_URL` (default `http://localhost:9003`), `PORT` (default 8080).

Keyboard: `1`–`6` switch views. Filters live in the URL hash so a view can be shared.

## API routes

`server/index.js` proxies OpenCost and serves the built UI:

- `GET /api/raw/allocation|assets|cloudCost?...` — passes the query string to OpenCost and returns `{ url, ms, response }` with the response untouched.
- `GET /api/allocation?window=7d` — allocation rows with per-step history (field aliases such as `cpuReq` map 1:1 to OpenCost fields; the UI labels columns with the OpenCost names).
- `GET /api/utilization?window=24h&namespace=` — usage/request series summed from allocation steps.
- `GET /api/status` — OpenCost reachability and whether `/cloudCost` is enabled.

The enrichment modules under `server/enrich/` (ownership, categories, inventory join, detection rules) and their `config/*.json` files are still in the repo but no longer used by the UI.

## Turning on cloud costs

OpenCost only serves `/cloudCost` when it can read a billing export. The pieces are: a billing export on the cloud side, a `cloud-integration.json` secret, and two Helm values. Files for this live in `deploy/`.

1. Create the billing export.
   - AWS: Billing → Cost and Usage Reports → create a report with **Include resource IDs** and **Athena** integration (Parquet, hourly). Deploy the CloudFormation template AWS drops in the bucket so Athena gets a database and table. Give the OpenCost user or role `athena:*` on that workgroup, `glue:Get*` on the database, and `s3:GetObject`/`ListBucket` on the CUR bucket plus `s3:PutObject` on the Athena results bucket.
   - GCP: Billing → Billing export → enable **Detailed usage cost** to BigQuery. Give a service account BigQuery Job User on the project and BigQuery Data Viewer on the dataset.
   - Azure: Cost Management → Exports → daily **Amortized cost** export to a storage account. Use that storage account's access key.
2. Copy `deploy/cloud-integration.example.json` to `cloud-integration.json`, keep only your provider block, fill it in, and create the secret:
   ```bash
   kubectl -n opencost create secret generic cloud-costs --from-file=cloud-integration.json
   ```
3. Enable the pipeline on the existing release:
   ```bash
   helm repo add opencost https://opencost.github.io/opencost-helm-chart && helm repo update
   helm -n opencost upgrade opencost opencost/opencost --version 2.5.31 --reuse-values -f deploy/opencost-cloudcost-values.yaml
   kubectl -n opencost rollout status deploy/opencost
   ```
4. Wait for the first run (it starts on boot and pulls the last 3 days, then repeats every 6 hours) and check:
   ```bash
   kubectl -n opencost logs deploy/opencost -c opencost | grep -i cloudcost
   curl 'http://localhost:9003/cloudCost?window=7d&aggregate=service'
   ```
   The Cloud costs view and the sidebar status flip to live as soon as that returns 200.

Resource IDs matter: without them `providerID` is empty, per-resource grouping is impossible and `kubernetesPercent` stays 0, because OpenCost matches billing resource IDs against node and volume IDs from `/assets`.

## Notes on this cluster

- Cloud billing is disabled in the OpenCost deployment (`CLOUD_COST_ENABLED=false`), so `/cloudCost` returns 404 and the Cloud costs view says so.
- The node has no configured price (provider `custom`), so OpenCost reports zero idle cost. Set custom pricing in the OpenCost config map to make idle capacity show up.
- `local-path` volumes have no filesystem of their own, so the Disk assets' `byteHoursUsed` and `byteUsageMax` reflect the node root disk, not the claim.
# costlens
