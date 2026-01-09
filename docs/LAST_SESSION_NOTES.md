Create the `scp` database using the backend venv (PowerShell, `$` in password is escaped for PS):

```powershell
python -c "import psycopg2; conn=psycopg2.connect(host='localhost', dbname='postgres', user='postgres', password='`$tanP1234'); conn.autocommit=True; cur=conn.cursor(); cur.execute(`"SELECT 1 FROM pg_database WHERE datname='scp'`"); exists=cur.fetchone(); print('exists' if exists else 'creating'); cur.execute('CREATE DATABASE scp') if not exists else None; cur.close(); conn.close()"
```
