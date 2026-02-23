import http.server
import socketserver

PORT = 8610

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # These headers are required for SharedArrayBuffer and WASM in modern browsers
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

print(f"Serving at http://localhost:{PORT}")
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()