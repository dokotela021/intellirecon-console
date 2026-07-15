package auth

import (
	"intellirecon-scanner/internal/providers"
)

// Compile-time assertion: *providers.Service satisfies
// auth.CatalogResolver structurally so Wave E task 5.4 can pass a
// *providers.Service directly to NewStore without an adapter.
var _ CatalogResolver = (*providers.Service)(nil)
