# The Databricks platform model

Read this before you draw where Databricks objects live: accounts, workspaces, the metastore and catalogs, storage, compute, identity, or the network around them. It holds the facts that change what is drawn, and how to draw each one. Products and how they wire together are in `component-catalog.md`. The cloud-specific private-connectivity patterns are in `style-networking.md`.

## Containment: what holds what

```
Account (account console)
├── Identity: users, groups, service principals   ← synced from the IdP (SCIM)
├── Network objects: NCCs (per region), network policies
├── Metastore (one per region)
│   ├── Catalog ⊃ Schema ⊃ tables · views · volumes · functions · models · metric views
│   └── Storage credentials, external locations, connections, shares
└── Workspaces (each attached to its region's metastore)
```

- **Account.** The top level, managed in the account console. Identity, metastores, workspaces and the serverless network objects (NCCs, network policies) are account-level.
- **Identity.** Users and groups come from the customer's IdP (Entra ID, Okta…) into the *account* through SCIM provisioning. On Azure, automatic identity management also syncs Entra groups and service principals. They are then assigned to workspaces (identity federation). Draw the IdP outside the account box, one edge "SCIM sync" into an identity node inside it.
- **Metastore.** One Unity Catalog metastore per region. Every workspace in that region attaches to it, and it is not an isolation unit: isolation comes from catalogs and bindings.
- **Workspaces do not contain catalogs.** Catalogs belong to the metastore. A workspace reaches them through its attachment, and a **catalog binding** can restrict a catalog to listed workspaces (mode ISOLATED, read-write or read-only). Draw workspaces and catalogs as siblings with an edge "bound", never a catalog inside a workspace box.
- **Three-level namespace.** `catalog.schema.object`. Objects: tables (managed by default; Delta, or managed Iceberg), views, volumes (files), functions, models, metric views. Storage credentials, external locations, connections and shares hang off the metastore, not off a catalog.

## Environments and organisation

- **The documented pattern:** dev, staging and prod as separate workspaces on the one regional metastore, with one catalog per environment bound to its workspace. Catalogs per business unit or domain are the other common split, and the two combine (`sales_prod`, `sales_dev`).
- **Promotion** is code, not data: Git → **Declarative Automation Bundles** (formerly Databricks Asset Bundles; same `bundle` CLI) deployed by CI/CD to each environment's workspace. Icons: `file:databricks-line/asset-bundle`, `file:vendor/github`, `file:cloud/azure/devops/azure-devops`.
- **Several regions** = several metastores, one per region. Data crosses them by Delta Sharing (below), never by one metastore spanning regions.

## Storage

- Data lives in the **customer's cloud storage** (S3, ADLS storage account, GCS), not in Databricks.
- **Managed storage** is set on the catalog or schema; managed tables and volumes are written there.
- **External tables and volumes** live in an **external location** = a cloud path + a **storage credential** (an IAM role on AWS, a managed identity through an access connector on Azure, a service account on GCP).
- Draw the bucket or storage account outside the Databricks boxes, in the customer's cloud box, and the catalog → storage edge labelled with what it carries ("managed storage", "external location").

## Compute planes

- **Control plane:** Databricks-managed (the workspace UI and APIs, job scheduling, the Unity Catalog service). Draw it as its own box labelled "Databricks-managed", apart from the customer's cloud.
- **Classic compute plane:** clusters in the customer's cloud account, in a customer-managed VPC (AWS, GCP) or an injected VNet (Azure). Secure cluster connectivity: no public IPs on the nodes, a relay to the control plane over 443.
- **Serverless compute plane:** in Databricks' cloud account, **never inside the customer's VPC or VNet**. Serverless SQL warehouses, serverless notebooks and jobs, and serverless Lakeflow pipelines run here. To reach customer resources it needs an NCC (next section).
- Icons: classic `file:databricks-line/spark-cluster`, serverless `file:databricks-line/serverless`, SQL warehouse `file:databricks-line/data-warehouse`.

## Network terms (one line each; the patterns are in `style-networking.md`)

| Term | What it is | Draw as |
|---|---|---|
| Front-end Private Link | users and clients reach the workspace UI/API privately | an endpoint in the customer network, edge to the control plane |
| Back-end (classic) Private Link | classic compute reaches the control plane privately | an endpoint in the workspace VPC/VNet, edge to the control plane |
| VNet injection / customer-managed VPC | classic compute runs in the customer's own network | the workspace network box with its subnets |
| NCC (Network Connectivity Configuration) | account-level, per-region object attached to workspaces; holds serverless private connectivity | a small account-level node, edge "attached" to the workspaces |
| Private endpoint rule | in an NCC: a private endpoint from serverless to one customer resource or load balancer | an edge from serverless into the resource's private endpoint |
| Private Network Gateway (PNG) | in an NCC: a managed interface in a customer subnet, so serverless traffic leaves through the customer network (Azure: Public Preview; AWS: Private Preview) | a NIC node in a dedicated subnet, on the path to on-premises |
| Network policy | account-level serverless egress control (allowed destinations; dry-run mode) | a note or a node on the serverless egress edge |
| IP access list | allows only listed public IPs to the console and workspaces; does not apply to Private Link traffic | a note on the user → workspace edge |

Private endpoint rules take priority over the PNG, which takes priority over default egress.

## Across workspaces, organisations and systems

- **Delta Sharing:** share data from one metastore to another (Databricks-to-Databricks, across accounts, regions and clouds) or to a non-Databricks recipient (open sharing). No copy; cross-region or cross-cloud reads can incur egress. Tile `delta-sharing`; icons `file:db/share`, `file:db/catalog-shared`.
- **Lakehouse Federation:** a UC connection + a foreign catalog queries an external database in place (PostgreSQL, MySQL, Oracle, Snowflake, BigQuery…). Catalog federation also mounts a Hive metastore or AWS Glue. Icons `file:db/connect` (connection), `file:db/table-globe` (foreign catalog).
- **Lakebase:** managed Postgres for operational workloads; UC tables sync into it for low-latency reads. Tile `lakebase`. Not a Delta table: never draw it inside the medallion.
- **Disaster recovery:** a second region means a second workspace and metastore. Managed disaster recovery (gated, set up through the account team) replicates UC metadata and managed data to a failover group; failover is started by a person, never automatic. Without it, replicate data (Deep Clone or Delta Sharing) and redeploy code through the bundles.

## Products without a tile

Draw these as a `logo` (or a `card` in the technical style) with the icon below. Never invent a tile type.

| Product | Icon |
|---|---|
| Metric views (consumed by dashboards, Genie, SQL, and Power BI / Tableau / Sigma) | `file:db/metric-view` |
| AI Functions (`ai_query`, `ai_classify`, `ai_parse_document`…) | `file:db/function` |
| Lakeflow Designer | `file:db/lakeflow-designer` |
| Serverless compute | `file:databricks-line/serverless` |
| Classic compute | `file:databricks-line/spark-cluster` |
| Genie ZeroOps | `file:vendor/zeroops` |
| Workspace | `file:databricks-line/databricks-workspace` |
| Metastore | `file:databricks-line/catalog-store` |
| Catalog | `file:db/catalog` |
| Identity provider / identity | `file:databricks-line/identity` |
| Service principal | `file:db/user-badge` |
| Storage credential | `file:db/cloud-key` (Azure access connector: `file:databricks-line/access-connector`) |
| Cloud storage | `file:cloud/aws/storage/s3`, `file:cloud/azure/storage/storage-account`, `file:cloud/gcp/storage/cloud-storage` |

## Never draw

- A catalog, schema or table inside a workspace box.
- One metastore per workspace, or one metastore spanning regions.
- Serverless compute inside the customer's VPC or VNet.
- The customer's tables or files stored in the control plane box: they live in the customer's cloud storage.
- Lakebase as a medallion layer, or Delta Sharing as a copy job.

**Example:** `customer-estate.jsonc` (one account on Azure: IdP, three environments, the metastore and its bound catalogs, the storage behind them).
