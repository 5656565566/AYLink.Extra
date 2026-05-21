package i18n

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	webassets "aylink-agent"
	domaini18n "aylink-agent/internal/domain/i18n"
)

const DefaultLocale = "zh-CN"

var ErrInvalidLocale = errors.New("invalid locale")

type Service struct {
	languageDir      string
	embeddedLanguage fs.FS
}

func NewService() *Service {
	embeddedLanguage, _ := webassets.EmbeddedLanguage()
	return &Service{
		languageDir:      resolveLanguageDirectory(),
		embeddedLanguage: embeddedLanguage,
	}
}

func (s *Service) GetLanguages() ([]domaini18n.LanguageOption, error) {
	entries, err := s.readDir()
	if err != nil {
		return nil, err
	}

	languages := make([]domaini18n.LanguageOption, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := entry.Name()
		if filepath.Ext(name) != ".json" || name == "template.json" {
			continue
		}

		locale := strings.TrimSuffix(name, ".json")
		payload, err := s.GetLanguage(locale)
		if err != nil {
			continue
		}

		displayName := locale
		if value, ok := payload["LanguageName"].(string); ok && strings.TrimSpace(value) != "" {
			displayName = value
		}

		languages = append(languages, domaini18n.LanguageOption{
			Locale: locale,
			Name:   displayName,
		})
	}

	sort.Slice(languages, func(i, j int) bool {
		return languages[i].Locale < languages[j].Locale
	})

	return languages, nil
}

func (s *Service) GetLanguage(locale string) (map[string]any, error) {
	if !IsValidLocale(locale) {
		return nil, ErrInvalidLocale
	}

	safeLocale := locale
	if !s.LocaleExists(locale) {
		safeLocale = DefaultLocale
	}

	template, err := s.readJSONFile("template.json")
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	language, err := s.readJSONFile(safeLocale + ".json")
	if err != nil {
		return nil, err
	}

	mergeMissing(language, template)
	return language, nil
}

func (s *Service) LocaleExists(locale string) bool {
	return IsValidLocale(locale) && s.fileExists(locale+".json")
}

func IsValidLocale(locale string) bool {
	if len(locale) != 5 {
		return false
	}

	return locale[0] >= 'a' && locale[0] <= 'z' &&
		locale[1] >= 'a' && locale[1] <= 'z' &&
		locale[2] == '-' &&
		locale[3] >= 'A' && locale[3] <= 'Z' &&
		locale[4] >= 'A' && locale[4] <= 'Z'
}

func resolveLanguageDirectory() string {
	candidates := []string{
		filepath.Join(".", "Language"),
	}

	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}

	return candidates[0]
}

func readJSONFile(path string) (map[string]any, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	payload := map[string]any{}
	if len(content) == 0 {
		return payload, nil
	}

	if err := json.Unmarshal(content, &payload); err != nil {
		return nil, err
	}

	return payload, nil
}

func mergeMissing(target, fallback map[string]any) {
	for key, fallbackValue := range fallback {
		targetValue, exists := target[key]
		if !exists {
			target[key] = fallbackValue
			continue
		}

		targetMap, targetOK := targetValue.(map[string]any)
		fallbackMap, fallbackOK := fallbackValue.(map[string]any)
		if targetOK && fallbackOK {
			mergeMissing(targetMap, fallbackMap)
		}
	}
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func (s *Service) readDir() ([]fs.DirEntry, error) {
	if entries, err := os.ReadDir(s.languageDir); err == nil {
		return entries, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	if s.embeddedLanguage == nil {
		return nil, os.ErrNotExist
	}

	return fs.ReadDir(s.embeddedLanguage, ".")
}

func (s *Service) readJSONFile(name string) (map[string]any, error) {
	diskPath := filepath.Join(s.languageDir, name)
	if payload, err := readJSONFile(diskPath); err == nil {
		return payload, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	if s.embeddedLanguage == nil {
		return nil, os.ErrNotExist
	}

	content, err := fs.ReadFile(s.embeddedLanguage, name)
	if err != nil {
		return nil, err
	}

	payload := map[string]any{}
	if len(content) == 0 {
		return payload, nil
	}

	if err := json.Unmarshal(content, &payload); err != nil {
		return nil, err
	}

	return payload, nil
}

func (s *Service) fileExists(name string) bool {
	if fileExists(filepath.Join(s.languageDir, name)) {
		return true
	}

	if s.embeddedLanguage == nil {
		return false
	}

	info, err := fs.Stat(s.embeddedLanguage, name)
	return err == nil && !info.IsDir()
}
