"""
QC (Quality Control) domain package.

Provides:
- schema.py           : SQL Server table creation (ensure_qc_schema, ensure_rbac_schema)
- inspection_repository.py : CRUD for inspection events and target results
- deployment_repository.py : Template deployment per line/station
- aggregate_repository.py  : Counter bucket aggregation and dashboard queries
- rbac_repository.py       : Fine-grained RBAC tables and resolution
"""
