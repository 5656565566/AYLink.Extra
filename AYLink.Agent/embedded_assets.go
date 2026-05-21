package webassets

import (
	"embed"
	"io/fs"
)

//go:embed all:www all:Language
var embeddedFiles embed.FS

func EmbeddedWWW() (fs.FS, error) {
	return fs.Sub(embeddedFiles, "www")
}

func EmbeddedLanguage() (fs.FS, error) {
	return fs.Sub(embeddedFiles, "Language")
}
