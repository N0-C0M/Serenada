package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseAllowedOriginsEmpty(t *testing.T) {
	origins := parseAllowedOrigins("")
	if len(origins) != 0 {
		t.Fatalf("expected empty map, got %d entries", len(origins))
	}
}

func TestParseAllowedOriginsSingle(t *testing.T) {
	origins := parseAllowedOrigins("https://example.com")
	if !origins["https://example.com"] {
		t.Fatalf("expected origin to be present")
	}
	if len(origins) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(origins))
	}
}

func TestParseAllowedOriginsMultiple(t *testing.T) {
	origins := parseAllowedOrigins("https://a.com, https://b.com,https://c.com")
	if len(origins) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(origins))
	}
	for _, o := range []string{"https://a.com", "https://b.com", "https://c.com"} {
		if !origins[o] {
			t.Fatalf("expected %q to be present", o)
		}
	}
}

func TestParseAllowedOriginsWhitespace(t *testing.T) {
	origins := parseAllowedOrigins("  https://a.com  ,  ")
	if len(origins) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(origins))
	}
	if !origins["https://a.com"] {
		t.Fatalf("expected trimmed origin to be present")
	}
}

func TestIsOriginAllowedEmptyOriginHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if !isOriginAllowed(req) {
		t.Fatalf("empty origin should be allowed")
	}
}

func TestIsOriginAllowedMatchesConfigured(t *testing.T) {
	original := allowedOrigins
	allowedOrigins = parseAllowedOrigins("https://serenada.app")
	defer func() { allowedOrigins = original }()

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://serenada.app")
	if !isOriginAllowed(req) {
		t.Fatalf("configured origin should be allowed")
	}
}

func TestIsOriginAllowedRejectsUnknown(t *testing.T) {
	original := allowedOrigins
	allowedOrigins = parseAllowedOrigins("https://serenada.app")
	defer func() { allowedOrigins = original }()

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://evil.com")
	if isOriginAllowed(req) {
		t.Fatalf("unknown origin should be rejected")
	}
}

func TestIsOriginAllowedLocalhostBypass(t *testing.T) {
	original := allowedOrigins
	allowedOrigins = parseAllowedOrigins("")
	defer func() { allowedOrigins = original }()

	for _, origin := range []string{
		"http://localhost",
		"http://localhost:3000",
		"http://localhost:8080",
	} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Origin", origin)
		if !isOriginAllowed(req) {
			t.Fatalf("localhost origin %q should be allowed", origin)
		}
	}
}

func TestIsOriginAllowedHostFallback(t *testing.T) {
	original := allowedOrigins
	allowedOrigins = parseAllowedOrigins("")
	defer func() { allowedOrigins = original }()

	req := httptest.NewRequest(http.MethodGet, "http://myapp.example.com/", nil)
	req.Host = "myapp.example.com"
	req.Header.Set("Origin", "https://myapp.example.com")
	if !isOriginAllowed(req) {
		t.Fatalf("origin matching Host header should be allowed")
	}
}

func TestIsOriginAllowedHostFallbackMismatch(t *testing.T) {
	original := allowedOrigins
	allowedOrigins = parseAllowedOrigins("")
	defer func() { allowedOrigins = original }()

	req := httptest.NewRequest(http.MethodGet, "http://myapp.example.com/", nil)
	req.Host = "myapp.example.com"
	req.Header.Set("Origin", "https://other.example.com")
	if isOriginAllowed(req) {
		t.Fatalf("origin not matching Host should be rejected")
	}
}

func TestIsOriginAllowedEmptyHostRejects(t *testing.T) {
	original := allowedOrigins
	allowedOrigins = parseAllowedOrigins("")
	defer func() { allowedOrigins = original }()

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Host = ""
	req.Header.Set("Origin", "https://something.com")
	if isOriginAllowed(req) {
		t.Fatalf("non-localhost origin with empty host should be rejected")
	}
}
