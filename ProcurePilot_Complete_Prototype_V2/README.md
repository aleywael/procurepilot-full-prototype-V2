# ProcurePilot Complete Prototype V2

A deployable static prototype of the full ProcurePilot graduation-project concept.

## Core modules included

1. Overview / Decision Workbench
2. **Interactive Procurement Dashboard**
3. Import & Smart Field Mapping
4. Data Cleaning & Validation
5. KPI-specific Analysis Readiness
6. KPI Engine
7. Priority Exception Inbox
8. Evidence Packet
9. What Changed Since Last Upload
10. Supplier Performance & Comparison
11. Predictive Supplier / PO Risk
12. Explainable Prediction
13. Decision Reliability Score
14. What-if Supplier Allocation Simulator
15. Procurement AI Copilot prototype
16. AI Decision Advisor + AI Challenger behavior
17. Decision Journal
18. Outcome Tracking
19. Decision Memory Matching
20. **Personalized Dashboard Builder with checkboxes**
21. Admin / Rules / Audit
22. Human-in-the-loop final decision control

## Dashboard visuals included

- OTD KPI
- Total Spend KPI
- Overdue Open POs KPI
- Highest Supplier Risk KPI
- OTD Trend
- Monthly Procurement Spend
- Supplier Risk Ranking
- Quality Rejection by Supplier
- Average Delay by Supplier
- Spend by Category
- Supplier / Category / Status filters
- Custom dashboard selection via checkboxes
- Role presets for Analyst, Manager and Quality-focused users

## Test workflow

1. Baseline data loads automatically.
2. Check Overview and Dashboard.
3. Open a Priority Issue and inspect the Evidence Packet.
4. Open Predictive Risk and inspect Explainable Prediction + Decision Reliability.
5. Run a What-if Scenario.
6. Ask the AI Copilot questions.
7. Save a Decision.
8. Go to Import & Readiness and load `sample_followup.csv`.
9. Check What Changed and Decisions & Outcomes.
10. Open Dashboard Builder and choose your own KPI cards/charts.

## Run locally

```bash
cd ProcurePilot_Complete_Prototype_V2
python3 -m http.server 8000
```

Open:
http://127.0.0.1:8000

## Deploy to Vercel

This is a static site.

1. Upload the contents of this folder to a GitHub repository.
2. Import the repository in Vercel.
3. Framework preset: **Other**
4. If these files are inside a subfolder, set that folder as Vercel's Root Directory.
5. Deploy.

No build command or environment variables are required.

## Prototype limitations

- Predictive risk is a transparent deterministic demonstration model, not a trained production ML model.
- The AI Copilot is a local evidence-grounded prototype rather than an external LLM API.
- Browser localStorage stores decisions, audit activity and dashboard preferences.
- A production implementation can replace these with trained ML, controlled LLM tool-calling, PostgreSQL, authentication, server-side audit logs and a read-only SAP/ERP API connection.
