"""Download one file over many parallel range requests, for servers that throttle each connection.

    python3 fetch_ranges.py <url> <output> [connections]
"""
import concurrent.futures
import sys
import urllib.request

CHUNK = 8 * 1024 * 1024


def fetch(url, start, end):
    request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return start, response.read()
        except OSError:
            if attempt == 4:
                raise


def main():
    url, output = sys.argv[1], sys.argv[2]
    connections = int(sys.argv[3]) if len(sys.argv) > 3 else 24
    with urllib.request.urlopen(urllib.request.Request(url, method="HEAD")) as response:
        size = int(response.headers["Content-Length"])
    ranges = [(start, min(start + CHUNK, size) - 1) for start in range(0, size, CHUNK)]
    with open(output, "wb") as file, concurrent.futures.ThreadPoolExecutor(connections) as pool:
        file.truncate(size)
        for start, data in pool.map(lambda r: fetch(url, *r), ranges):
            file.seek(start)
            file.write(data)
    print(f"{output}: {size} bytes")


main()
