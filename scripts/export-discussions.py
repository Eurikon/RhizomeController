import json
import os
from pathlib import Path
from datetime import datetime, timezone
from urllib.request import Request, urlopen


QUERY = """
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    discussions(first: 5, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number title bodyHTML url updatedAt
        category { name }
        author { login url avatarUrl }
        comments { totalCount }
      }
    }
  }
}
"""


def fetch_discussions(repository, token):
    owner, name = repository.split("/", 1)
    request = Request(
        "https://api.github.com/graphql",
        data=json.dumps({"query": QUERY, "variables": {"owner": owner, "name": name}}).encode(),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    with urlopen(request, timeout=30) as response:
        result = json.load(response)
    if result.get("errors"):
        raise ValueError("GitHub could not export the discussions")
    discussions = result["data"]["repository"]["discussions"]["nodes"]
    if not isinstance(discussions, list) or len(discussions) > 5:
        raise ValueError("Unexpected discussion list")
    for item in discussions:
        if not isinstance(item["number"], int) or item["number"] < 1:
            raise ValueError("Invalid discussion number")
        if item["url"] != f"https://github.com/{repository}/discussions/{item['number']}":
            raise ValueError("Unexpected discussion URL")
        for key in ("title", "bodyHTML", "updatedAt"):
            if not isinstance(item[key], str):
                raise ValueError("Invalid discussion content")
        datetime.fromisoformat(item["updatedAt"].replace("Z", "+00:00"))
    return sorted(discussions, key=lambda item: (item["updatedAt"], item["number"]), reverse=True)


def write_feed(path, discussions):
    if path.exists():
        previous = json.loads(path.read_text())
        if previous.get("version") == 1 and previous.get("discussions") == discussions:
            return False
    payload = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "discussions": discussions,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)
    return True


if __name__ == "__main__":
    repository = os.environ.get("GITHUB_REPOSITORY", "Eurikon/RhizomeController")
    discussions = fetch_discussions(repository, os.environ["GH_TOKEN"])
    changed = write_feed(Path("feed/discussions.json"), discussions)
    print("Discussion feed updated." if changed else "Discussion feed unchanged.")
