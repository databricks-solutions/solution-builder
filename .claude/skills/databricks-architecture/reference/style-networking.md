# Style: networking

**When:** the question is where things run and how they connect: accounts, regions, VPCs, subnets, availability zones, PrivateLink, control plane vs data plane.

**Building blocks**
- Containment with `box` only: region ⊃ VPC ⊃ subnet ⊃ compute. The region box has `titleIcon:"lucide:globe"`; the VPC has `titleIcon:"file:cloud/aws/networking/vpc"`. The CIDR goes in the box `subtitle` (`"10.0.0.0/16"`). On Azure use `file:cloud/azure/…`: `general/subscription`, `networking/virtual-network`, `networking/subnet`, and for what sits in them `networking/vpn-gateway`, `networking/expressroute`, `networking/network-interface`, `networking/private-endpoint`, `networking/private-link-service`, `networking/load-balancer`, `networking/application-gateway`, `networking/firewall`, `networking/bastion`, `networking/nat-gateway`, `networking/local-network-gateway` (the on-prem VPN device). On AWS, containers take the official group icons as `titleIcon` (`file:cloud/aws/general/…`: `account`, `aws-cloud`, `region`, `vpc-group`, `private-subnet`, `public-subnet`, `corporate-data-center`); what sits in them: `networking/transit-gateway`, `networking/direct-connect`, `networking/direct-connect-gateway`, `networking/site-to-site-vpn`, `networking/vpn-gateway`, `networking/customer-gateway`, `networking/privatelink`, `networking/vpc-endpoint`, `networking/elastic-network-interface`, `networking/network-load-balancer`, `networking/application-load-balancer`, `networking/peering-connection`, `networking/route53-resolver`, `security/network-firewall`, `security/iam-role`, `compute/ec2-instance`. On GCP (`file:cloud/gcp/networking/…`): `vpc`, `private-service-connect`, `load-balancing`, `cloud-router`, `cloud-vpn`, `cloud-interconnect`, `partner-interconnect`, `cloud-nat`, `cloud-dns`, `firewall-rules`, `network-connectivity-center`, `cloud-service-mesh` (Envoy proxies). More Azure: `network-security-group`, `public-ip`, `dns-zone`, `virtual-wan`, `virtual-wan-hub`, `connection`, `private-link`. `grep` `icons.tsv` for the rest.
- `box` `title` names the plane: `"Databricks control plane"` with the subtitle `"Databricks-managed · no customer data"`.
- Compute as `card` (`file:databricks-line/spark-cluster`, body "Workers · no public IP").
- Endpoints as `logo` with the cloud icon (`file:cloud/aws/networking/vpc-endpoint`, Azure `networking/private-endpoint`, GCP `networking/private-service-connect`). The storage bucket as `file:cloud/aws/storage/s3`, outside the VPC box so its edge crosses the VPC border on purpose.
- Front-end and back-end Private Link are two different endpoints in two places: the front-end one in a transit VPC/VNet the users network reaches, the back-end ones (REST API, SCC relay) in the workspace VPC/VNet. Never draw one endpoint for both.
- The user as `logo` with `icon:"file:persona/user"`.

**Layout**
- `theme:"technical"`, `aspect:"16:9"`, `direction:"horizontal"`.
- The top level is a row in traffic order: users | customer account / network | Databricks control plane. Everything that leaves the customer network goes to the control plane, so put the control plane LAST: every Private Link edge then runs one way. With the control plane between the users and the network, the back-end lines run backwards across the network boxes.
- Inside the workspace VPC, a row: the AZ subnets (a column `group`, one subnet each), then an endpoint subnet holding the back-end endpoints, on the side facing the control plane. Compute → endpoint → control plane then crosses no subnet. Never put an endpoint between two AZ subnets.
- Give each endpoint and what it reaches one `track` (front-end endpoint with the web app, SCC endpoint with the relay), so each Private Link line is straight.
- One endpoint per service per VPC is enough to show the pattern; don't repeat it per AZ unless the story says so.
- Read left→right in traffic order: users / internet → entry endpoints → control plane → customer network and data plane. Egress and firewall sit IN the path between the workload and the outside, not beside it. Put the endpoints in their own column between two zones, so no edge runs across a zone's title strip.
- Draw only the networks, subnets, CIDRs and endpoints the prompt names. Add no hub or transit network, and no CIDR, unless the prompt gives it.

**Examples:** `style-networking.jsonc` (AWS classic compute: customer-managed VPC, front-end + back-end PrivateLink, two AZs; on Azure the same picture is VNet injection + Private Link). The terms (NCC, PNG, private endpoint rule, front-end vs back-end Private Link) are defined in `platform-model.md`. The references below draw serverless reaching a private network: the traffic path as one row of hops in one colour, the networks it does not use dashed. Each header explains how the path works on Databricks and when to pick it.

**Private connectivity references** (serverless → a private network or on-premises):

| Cloud | Mechanism | Reference |
|---|---|---|
| Azure | Private Network Gateway (PNG) in a hub VNet | `serverless-png-azure.jsonc` |
| AWS | PNG in a shared services VPC, cross-account IAM role, Transit Gateway | `serverless-png-aws.jsonc` |
| Azure | NCC private endpoint rule → Private Link Service → load balancer → proxy VMs | `serverless-pls-azure.jsonc` |
| Azure | NCC private endpoint rule → Application Gateway (no proxy VMs) | `serverless-appgw-azure.jsonc` |
| AWS | NCC private endpoint rule → PrivateLink → endpoint service → NLB | `serverless-privatelink-nlb-aws.jsonc` |
| GCP | NCC private endpoint rule → Private Service Connect → proxy load balancer → hybrid NEG | `serverless-psc-gcp.jsonc` |
| Azure | No inbound allowed: reverse tunnel from an on-prem host to proxy VMs | `serverless-tunnel-azure.jsonc` |
| AWS | No inbound allowed: reverse tunnel from an on-prem host to proxy EC2s behind an NLB | `serverless-tunnel-aws.jsonc` |
| Azure | Where the PNG subnet sits in a hub-and-spoke network | `png-topology-hub-spoke.jsonc` |
| Azure | Peered spoke (uses the hub PNG) vs isolated spoke (its own PNG) | `png-topology-isolated-spoke.jsonc` |
| Azure | Genie One → Unity Gateway → PNG → on-prem custom MCP server | `genie-one-mcp-png-azure.jsonc` |
| Azure | Lakeflow Connect Direct CDC from SQL Server / Oracle through PNG | `lakeflow-cdc-png-azure.jsonc` |
| AWS | Lakeflow Connect Direct CDC through PNG | `lakeflow-cdc-png-aws.jsonc` |
| GCP | Lakeflow Connect Direct CDC through Private Service Connect | `lakeflow-cdc-psc-gcp.jsonc` |
| Azure | Lakeflow Connect on-prem agent: pushes out over 443, no inbound connection | `lakeflow-onprem-agent-azure.jsonc` |
