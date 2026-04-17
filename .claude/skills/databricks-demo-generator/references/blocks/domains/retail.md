---
name: Retail & CPG
category: domain
suggested_patterns: [anomaly-detection, customer-segmentation, real-time-monitoring, predictive-maintenance]
suggested_capabilities: [aibi-dashboards, genie, sdp, knowledge-assistant, supervisor-agent, synthetic-data-gen]
---

## Terminology

- **SKU** — Stock Keeping Unit; unique identifier for each product variant (size, color, etc.)
- **BOPIS** — Buy Online, Pick Up In Store; omnichannel fulfillment pattern
- **Planogram** — Visual diagram dictating product placement on shelves
- **Shrinkage** — Inventory loss from theft, damage, administrative error, or vendor fraud
- **GMROI** — Gross Margin Return on Inventory Investment; profitability per dollar of inventory
- **Basket analysis** — Market basket analysis identifying products frequently purchased together
- **Price elasticity** — Sensitivity of demand to price changes; typically -1.5 to -3.0 for CPG staples
- **Dark store** — Retail location converted to a micro-fulfillment center for online orders
- **Sell-through rate** — Percentage of inventory sold vs. received in a given period
- **Customer lifetime value (CLV)** — Predicted total revenue from a customer over their relationship

## KPIs and Baseline Metrics

| KPI | Healthy Baseline | Red Flag |
|-----|-----------------|----------|
| Cart abandonment rate | 65-75% | >80% |
| Customer churn rate (monthly) | 3-5% | >8% |
| Inventory turnover (annual) | 8-12x | <6x |
| Gross margin | 25-45% (varies by category) | <20% |
| Return rate (ecommerce) | 15-20% | >30% |
| Out-of-stock rate | 5-8% | >10% |
| Average order value (AOV) | $50-$85 (general retail) | Declining >10% QoQ |
| Sell-through rate | 40-60% (first 8 weeks) | <30% |
| Net Promoter Score (NPS) | 30-50 | <20 |
| Fulfillment accuracy | 98-99.5% | <97% |

## Personas

- **Lisa Chen, VP of Merchandising** — Cares about sell-through rates, markdown optimization, and assortment planning. Needs visibility into which SKUs to promote vs. clearance.
- **Marcus Rivera, Director of Supply Chain** — Focused on inventory turns, out-of-stock rates, and demand forecasting accuracy. Worries about bullwhip effect in seasonal planning.
- **Priya Sharma, Head of Customer Analytics** — Owns churn prediction, CLV models, and personalization strategy. Measures campaign ROI and segment-level engagement.
- **James Okafor, Store Operations Manager** — Needs real-time planogram compliance, shrinkage alerts, and labor scheduling optimization.

## Data Entities and Relationships

- **Customers** (customer_id, segment, loyalty_tier, signup_date, ltv_score)
- **Transactions** (transaction_id, customer_id, store_id, timestamp, total_amount, channel)
- **Transaction Line Items** (transaction_id, sku_id, quantity, unit_price, discount_applied)
- **Products** (sku_id, category, subcategory, brand, cost, msrp, supplier_id)
- **Stores** (store_id, region, format, square_footage, open_date)
- **Inventory Snapshots** (sku_id, store_id, date, on_hand_qty, in_transit_qty, allocated_qty)
- **Returns** (return_id, transaction_id, sku_id, reason_code, return_date, refund_amount)
- **Promotions** (promo_id, sku_ids, discount_type, start_date, end_date, channel)

Key relationships: Customers -> Transactions -> Line Items -> Products; Inventory joins on (sku_id, store_id); Returns reference original Transactions.

## Regulatory and Compliance

- **PCI DSS** — Payment card data must be tokenized; no raw card numbers in analytics tables
- **CCPA / GDPR** — Customer PII requires consent tracking, right-to-delete capabilities, and data retention policies
- **FTC pricing regulations** — Promotional pricing claims must be substantiated (e.g., "was/now" pricing)
- **Food safety (CPG)** — Lot traceability required within 24 hours under FSMA for food products
- **Sales tax nexus** — Multi-state ecommerce requires accurate tax jurisdiction mapping

## Common Pain Points and Use Cases

1. **Demand forecasting** — Inaccurate forecasts cause both stockouts (lost sales) and overstock (markdowns). Seasonal and promotional demand spikes are hard to model.
2. **Customer churn prediction** — Identifying at-risk loyalty members before they lapse, especially after negative experiences (returns, service issues).
3. **Price optimization** — Balancing margin targets with competitive pricing; markdown timing to maximize recovery on slow-moving inventory.
4. **Returns fraud detection** — Wardrobing, receipt fraud, and serial returners cost retailers 5-10% of revenue.
5. **Omnichannel inventory visibility** — Customers expect real-time stock availability across channels; fragmented systems cause overselling.
6. **Market basket analysis** — Identifying cross-sell opportunities and optimizing product adjacencies in stores and recommendation engines.
