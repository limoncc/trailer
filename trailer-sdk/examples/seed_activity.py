"""Generate activity data with varied dates for the activity chart."""
import json, urllib.request, random
from datetime import datetime, timedelta

HOST = "http://127.0.0.1:5120"

# Login
req = urllib.request.Request(f"{HOST}/api/v1/auth/login",
    data=json.dumps({"username":"admin","password":"admin"}).encode(),
    headers={"content-type":"application/json"})
TOKEN = json.loads(urllib.request.urlopen(req).read())["token"]
HDR = {"content-type":"application/json", "authorization":f"Bearer {TOKEN}"}

# Create runs on random dates in the past 60 days
today = datetime.now()
for day_offset in range(60, -1, -1):
    date = today - timedelta(days=day_offset)
    count = random.choices([0, 0, 0, 1, 1, 2, 3], weights=[30, 20, 15, 15, 10, 5, 5])[0]
    for _ in range(count):
        name = f"run_{date.strftime('%m%d')}_{random.randint(0,999)}"
        body = json.dumps({
            "project": "demo",
            "name": name,
            "config": {"lr": round(random.uniform(0.0001, 0.1), 4)},
        })
        req = urllib.request.Request(f"{HOST}/api/v1/runs", data=body.encode(), headers=HDR, method="POST")
        try: urllib.request.urlopen(req)
        except: pass

print("✅ Activity seeding complete!")
