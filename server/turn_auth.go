package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type TurnConfig struct {
	Username string   `json:"username"`
	Password string   `json:"password"`
	URIs     []string `json:"uris"`
	TTL      int      `json:"ttl"`
}

type turnToken struct {
	ip      string
	expires time.Time
}

type TurnTokenStore struct {
	mu          sync.Mutex
	tokens      map[string]turnToken
	ttl         time.Duration
	lastCleanup time.Time
}

func NewTurnTokenStore(ttl time.Duration) *TurnTokenStore {
	return &TurnTokenStore{
		tokens:      make(map[string]turnToken),
		ttl:         ttl,
		lastCleanup: time.Now(),
	}
}

func (s *TurnTokenStore) Issue(ip string) (string, time.Time) {
	now := time.Now()
	b := make([]byte, 16)
	rand.Read(b)
	token := hex.EncodeToString(b)
	expires := now.Add(s.ttl)

	s.mu.Lock()
	if now.Sub(s.lastCleanup) >= s.ttl {
		for t, entry := range s.tokens {
			if now.After(entry.expires) {
				delete(s.tokens, t)
			}
		}
		s.lastCleanup = now
	}
	s.tokens[token] = turnToken{ip: ip, expires: expires}
	s.mu.Unlock()

	return token, expires
}

func (s *TurnTokenStore) Validate(token, ip string) bool {
	if token == "" {
		return false
	}
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	entry, ok := s.tokens[token]
	if !ok {
		return false
	}
	if now.After(entry.expires) {
		delete(s.tokens, token)
		return false
	}
	if entry.ip != "" && entry.ip != ip {
		return false
	}
	return true
}

func (s *TurnTokenStore) Delete(token string) {
	if token == "" {
		return
	}
	s.mu.Lock()
	delete(s.tokens, token)
	s.mu.Unlock()
}

func handleTurnCredentials(store *TurnTokenStore, diagnosticStore *TurnTokenStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		if store == nil && diagnosticStore == nil {
			http.Error(w, "TURN token store unavailable", http.StatusServiceUnavailable)
			return
		}

		token := r.Header.Get("X-Turn-Token")
		if token == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		clientIP := getClientIP(r)
		credentialTTL := 15 * 60 // default: 15 minutes
		isAuthorized := false

		if store != nil && store.Validate(token, clientIP) {
			isAuthorized = true
		} else if diagnosticStore != nil && diagnosticStore.Validate(token, clientIP) {
			isAuthorized = true
			credentialTTL = 5
			diagnosticStore.Delete(token)
		}

		if !isAuthorized {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// 1. Get Secret and Host from Env
		secret := os.Getenv("TURN_SECRET")
		turn_host := os.Getenv("TURN_HOST")
		stun_host := os.Getenv("STUN_HOST")
		if secret == "" || stun_host == "" {
			http.Error(w, "STUN not configured", http.StatusServiceUnavailable)
			return
		}

		// 2. Generate Credentials (Time-limited)
		// Standard TURN REST API: username = timestamp:user
		ttl := credentialTTL
		timestamp := time.Now().Unix() + int64(ttl)
		userPart := clientIP
		if userPart == "" {
			userPart = "unknown"
		}
		userPart = strings.ReplaceAll(userPart, ":", "-")
		userPart = strings.ReplaceAll(userPart, "%", "-")
		username := fmt.Sprintf("%d:%s", timestamp, userPart)

		// Password = HMAC-SHA1(secret, username)
		mac := hmac.New(sha1.New, []byte(secret))
		mac.Write([]byte(username))
		password := base64.StdEncoding.EncodeToString(mac.Sum(nil))

		config := TurnConfig{
			Username: username,
			Password: password,
			URIs: []string{
				"stun:" + stun_host,
				"turn:" + stun_host,
			},
			TTL: ttl,
		}

		if turn_host != "" {
			config.URIs = append(config.URIs, "turns:"+turn_host+":443?transport=tcp")
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(config)
	}
}

// TODO: Remove this
func handleDiagnosticToken(store *TurnTokenStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost && r.Method != http.MethodGet {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		if store == nil {
			http.Error(w, "TURN token store unavailable", http.StatusServiceUnavailable)
			return
		}

		token, expires := store.Issue(getClientIP(r))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"token":   token,
			"expires": expires.Unix(),
		})
	}
}
