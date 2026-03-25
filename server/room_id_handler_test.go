package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleRoomIDGetAndPost(t *testing.T) {
	t.Setenv("ROOM_ID_SECRET", "test-room-secret-1234")

	for _, method := range []string{http.MethodGet, http.MethodPost} {
		t.Run(method, func(t *testing.T) {
			handler := handleRoomID()
			req := httptest.NewRequest(method, "/api/room-id", nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d", w.Code)
			}

			if ct := w.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("expected Content-Type application/json, got %q", ct)
			}
			if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
				t.Fatalf("expected Cache-Control no-store, got %q", cc)
			}

			var resp map[string]string
			if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}
			if resp["roomId"] == "" {
				t.Fatalf("expected non-empty roomId")
			}
			if len(resp["roomId"]) != roomIDEncodedBytes {
				t.Fatalf("expected roomId length %d, got %d", roomIDEncodedBytes, len(resp["roomId"]))
			}
		})
	}
}

func TestHandleRoomIDWrongMethod(t *testing.T) {
	handler := handleRoomID()
	req := httptest.NewRequest(http.MethodPut, "/api/room-id", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

func TestHandleRoomIDMissingSecret(t *testing.T) {
	handler := handleRoomID()
	req := httptest.NewRequest(http.MethodGet, "/api/room-id", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
}

func TestHandleRoomIDValidatesGenerated(t *testing.T) {
	t.Setenv("ROOM_ID_SECRET", "test-room-secret-1234")

	handler := handleRoomID()
	req := httptest.NewRequest(http.MethodGet, "/api/room-id", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if err := validateRoomID(resp["roomId"]); err != nil {
		t.Fatalf("generated room ID failed validation: %v", err)
	}
}
