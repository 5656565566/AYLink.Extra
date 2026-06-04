package sqlite

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
	domaindevice "aylink-agent/internal/domain/device"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "sqlite-test.db")
	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func countRows(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()

	var count int
	if err := db.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatalf("countRows(%q) error = %v", query, err)
	}
	return count
}

func TestInitializeSeedsDefaultsIdempotently(t *testing.T) {
	db := newTestDB(t)

	if err := initialize(db); err != nil {
		t.Fatalf("initialize() error = %v", err)
	}

	if got := countRows(t, db, `SELECT COUNT(*) FROM Permissions`); got != 11 {
		t.Fatalf("expected 11 permissions, got %d", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM Roles WHERE Name = 'Administrator'`); got != 1 {
		t.Fatalf("expected single Administrator role, got %d", got)
	}

	var adminRoleID int
	if err := db.QueryRow(`SELECT Id FROM Roles WHERE Name = 'Administrator'`).Scan(&adminRoleID); err != nil {
		t.Fatalf("query Administrator role id error = %v", err)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM RolePermissions WHERE RoleId = ?`, adminRoleID); got != 11 {
		t.Fatalf("expected 11 admin role permissions, got %d", got)
	}

	if got := countRows(t, db, `SELECT COUNT(*) FROM Settings WHERE Key = 'webrtc_network_config'`); got != 1 {
		t.Fatalf("expected seeded webrtc_network_config, got %d rows", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM DeviceGroups WHERE Name = ? AND IsInternal = 1`, internalAllDevicesGroupName); got != 1 {
		t.Fatalf("expected seeded internal all-devices group, got %d", got)
	}
}

func TestInitializeBackfillsAndAutoAssignsInternalAllDevicesGroup(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "sqlite-migration.db")
	rawDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer rawDB.Close()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	legacyQueries := []string{
		`CREATE TABLE Devices (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			Name TEXT NOT NULL,
			Serial TEXT NOT NULL,
			IpAddress TEXT,
			Port INTEGER,
			Status TEXT NOT NULL DEFAULT 'unknown',
			LastSeen TEXT NOT NULL,
			CreatedAt TEXT NOT NULL,
			UpdatedAt TEXT NOT NULL
		)`,
		`CREATE TABLE Settings (
			Key TEXT PRIMARY KEY,
			Value TEXT NOT NULL,
			Description TEXT,
			UpdatedAt TEXT NOT NULL
		)`,
		`CREATE TABLE Users (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			Username TEXT NOT NULL UNIQUE,
			PasswordHash TEXT NOT NULL,
			PasswordSalt TEXT NOT NULL,
			IsActive INTEGER NOT NULL DEFAULT 1,
			CreatedAt TEXT NOT NULL,
			UpdatedAt TEXT NOT NULL,
			LastLoginAt TEXT
		)`,
		`CREATE TABLE Roles (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			Name TEXT NOT NULL UNIQUE,
			Description TEXT,
			IsInternal INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE Permissions (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			Code TEXT NOT NULL UNIQUE,
			Description TEXT
		)`,
		`CREATE TABLE UserRoles (
			UserId INTEGER NOT NULL,
			RoleId INTEGER NOT NULL,
			PRIMARY KEY (UserId, RoleId)
		)`,
		`CREATE TABLE RolePermissions (
			RoleId INTEGER NOT NULL,
			PermissionId INTEGER NOT NULL,
			PRIMARY KEY (RoleId, PermissionId)
		)`,
		`CREATE TABLE RefreshTokens (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			UserId INTEGER NOT NULL,
			TokenHash TEXT NOT NULL UNIQUE,
			ExpiresAt TEXT NOT NULL,
			RevokedAt TEXT,
			CreatedAt TEXT NOT NULL,
			LastUsedAt TEXT NOT NULL
		)`,
		`CREATE TABLE AccessTokens (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			UserId INTEGER NOT NULL,
			TokenHash TEXT NOT NULL UNIQUE,
			ExpiresAt TEXT NOT NULL,
			CreatedAt TEXT NOT NULL,
			LastSeenAt TEXT NOT NULL
		)`,
		`CREATE TABLE DeviceGroups (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			Name TEXT NOT NULL UNIQUE,
			Description TEXT,
			CreatedAt TEXT NOT NULL,
			UpdatedAt TEXT NOT NULL
		)`,
		`CREATE TABLE DeviceGroupDevices (
			GroupId INTEGER NOT NULL,
			DeviceId INTEGER NOT NULL,
			PRIMARY KEY (GroupId, DeviceId)
		)`,
		`CREATE TABLE UserDeviceGroups (
			UserId INTEGER NOT NULL,
			GroupId INTEGER NOT NULL,
			PRIMARY KEY (UserId, GroupId)
		)`,
		`CREATE TABLE RoleDeviceGroups (
			RoleId INTEGER NOT NULL,
			GroupId INTEGER NOT NULL,
			PRIMARY KEY (RoleId, GroupId)
		)`,
	}
	for _, query := range legacyQueries {
		if _, err := rawDB.Exec(query); err != nil {
			t.Fatalf("legacy schema exec error = %v", err)
		}
	}

	if _, err := rawDB.Exec(`INSERT INTO Devices (Name, Serial, Status, LastSeen, CreatedAt, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?)`, "Legacy Device", "legacy-serial", "online", now, now, now); err != nil {
		t.Fatalf("insert legacy device error = %v", err)
	}
	if _, err := rawDB.Exec(`INSERT INTO Roles (Name, Description, IsInternal) VALUES (?, ?, 1)`, "Administrator", "Full access"); err != nil {
		t.Fatalf("insert Administrator role error = %v", err)
	}
	if _, err := rawDB.Exec(`INSERT INTO Users (Username, PasswordHash, PasswordSalt, IsActive, CreatedAt, UpdatedAt) VALUES (?, ?, ?, 1, ?, ?)`, "legacy-admin", "hash", "salt", now, now); err != nil {
		t.Fatalf("insert legacy user error = %v", err)
	}
	if _, err := rawDB.Exec(`INSERT INTO UserRoles (UserId, RoleId) VALUES (1, 1)`); err != nil {
		t.Fatalf("insert legacy user role error = %v", err)
	}

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() migrated db error = %v", err)
	}
	defer db.Close()

	var internalGroupID int
	if err := db.QueryRow(`SELECT Id FROM DeviceGroups WHERE Name = ? AND IsInternal = 1`, internalAllDevicesGroupName).Scan(&internalGroupID); err != nil {
		t.Fatalf("query internal group error = %v", err)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM DeviceGroupDevices WHERE GroupId = ? AND DeviceId = 1`, internalGroupID); got != 1 {
		t.Fatalf("expected legacy device to be added into internal group, got %d rows", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM UserDeviceGroups WHERE UserId = 1 AND GroupId = ?`, internalGroupID); got != 1 {
		t.Fatalf("expected legacy admin user to be granted internal group, got %d rows", got)
	}
}

func TestAuthRepositoryCreateUserLoadsRolesAndPermissions(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	if adminRole == nil {
		t.Fatal("expected Administrator role to exist")
	}

	user, err := repo.CreateUser(ctx, "tester", "hash", "salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	if user == nil {
		t.Fatal("expected created user")
	}
	if user.Username != "tester" {
		t.Fatalf("expected username tester, got %s", user.Username)
	}
	if len(user.Roles) != 1 || user.Roles[0].Name != "Administrator" {
		t.Fatalf("expected Administrator role, got %+v", user.Roles)
	}
	if len(user.Permissions) != 11 {
		t.Fatalf("expected 11 permissions, got %d", len(user.Permissions))
	}
}

func TestAuthRepositoryGetUserByUsernameIsCaseInsensitive(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	if _, err := repo.CreateUser(ctx, "CaseUser", "hash", "salt", []int{adminRole.ID}, nil); err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	lowerUser, err := repo.GetUserByUsername(ctx, "caseuser")
	if err != nil {
		t.Fatalf("GetUserByUsername(caseuser) error = %v", err)
	}
	if lowerUser == nil || lowerUser.Username != "CaseUser" {
		t.Fatalf("expected case-insensitive username lookup, got %+v", lowerUser)
	}

	upperUser, err := repo.GetUserByUsername(ctx, "CASEUSER")
	if err != nil {
		t.Fatalf("GetUserByUsername(CASEUSER) error = %v", err)
	}
	if upperUser == nil || upperUser.Username != "CaseUser" {
		t.Fatalf("expected case-insensitive username lookup, got %+v", upperUser)
	}
}

func TestAuthRepositoryUpdateUserReplacesRolesAndPermissions(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName(Administrator) error = %v", err)
	}
	limitedRole, err := repo.CreateRole(ctx, "Device Viewer", "View-only device access", []string{"devices.view"}, nil)
	if err != nil {
		t.Fatalf("CreateRole() error = %v", err)
	}

	user, err := repo.CreateUser(ctx, "role-user", "hash", "salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	updated, err := repo.UpdateUser(ctx, user.ID, "role-user-updated", true, []int{limitedRole.ID}, nil)
	if err != nil {
		t.Fatalf("UpdateUser() error = %v", err)
	}
	if updated == nil {
		t.Fatal("expected updated user")
	}
	if updated.Username != "role-user-updated" {
		t.Fatalf("expected updated username, got %s", updated.Username)
	}
	if len(updated.Roles) != 1 || updated.Roles[0].Name != "Device Viewer" {
		t.Fatalf("expected single Device Viewer role, got %+v", updated.Roles)
	}
	if len(updated.Permissions) != 1 || updated.Permissions[0] != "devices.view" {
		t.Fatalf("expected only devices.view permission, got %+v", updated.Permissions)
	}
}

func TestAuthRepositoryListUsersHydratesDeviceAccessScope(t *testing.T) {
	db := newTestDB(t)
	authRepo := NewAuthRepository(db)
	deviceRepo := NewDeviceRepository(db)
	groupRepo := NewDeviceGroupRepository(db)
	ctx := context.Background()

	adminRole, err := authRepo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName(Administrator) error = %v", err)
	}
	viewerRole, err := authRepo.CreateRole(ctx, "Scoped Viewer", "Scoped device access", []string{"devices.view"}, nil)
	if err != nil {
		t.Fatalf("CreateRole() error = %v", err)
	}

	groupA, err := groupRepo.Create(ctx, "Warehouse A", "Warehouse devices")
	if err != nil {
		t.Fatalf("Create() groupA error = %v", err)
	}
	groupB, err := groupRepo.Create(ctx, "Warehouse B", "Backup devices")
	if err != nil {
		t.Fatalf("Create() groupB error = %v", err)
	}

	deviceOne := &domaindevice.Device{
		Name:      "Pixel A",
		Serial:    "serial-a",
		Status:    "online",
		LastSeen:  time.Now().UTC(),
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	if err := deviceRepo.Insert(ctx, deviceOne); err != nil {
		t.Fatalf("Insert(deviceOne) error = %v", err)
	}
	if err := groupRepo.SetGroupsForDevice(ctx, deviceOne.ID, []int{groupA.ID}); err != nil {
		t.Fatalf("SetGroupsForDevice(deviceOne) error = %v", err)
	}

	deviceTwo := &domaindevice.Device{
		Name:      "Pixel B",
		Serial:    "serial-b",
		Status:    "online",
		LastSeen:  time.Now().UTC(),
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	if err := deviceRepo.Insert(ctx, deviceTwo); err != nil {
		t.Fatalf("Insert(deviceTwo) error = %v", err)
	}
	if err := groupRepo.SetGroupsForDevice(ctx, deviceTwo.ID, []int{groupB.ID}); err != nil {
		t.Fatalf("SetGroupsForDevice(deviceTwo) error = %v", err)
	}

	deviceThree := &domaindevice.Device{
		Name:      "Pixel Unassigned",
		Serial:    "serial-unassigned",
		Status:    "online",
		LastSeen:  time.Now().UTC(),
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	if err := deviceRepo.Insert(ctx, deviceThree); err != nil {
		t.Fatalf("Insert(deviceThree) error = %v", err)
	}

	if err := authRepo.SetDeviceGroupsForRole(ctx, viewerRole.ID, []int{groupA.ID}); err != nil {
		t.Fatalf("SetDeviceGroupsForRole() error = %v", err)
	}

	user, err := authRepo.CreateUser(ctx, "scoped-user", "hash", "salt", []int{viewerRole.ID}, []int{groupB.ID})
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	if user == nil {
		t.Fatal("expected created user")
	}
	if user.EffectiveDeviceGroupCount != 2 {
		t.Fatalf("expected 2 effective groups at create time, got %d", user.EffectiveDeviceGroupCount)
	}

	adminUser, err := authRepo.CreateUser(ctx, "admin-user", "hash", "salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser(admin-user) error = %v", err)
	}
	if adminUser == nil {
		t.Fatal("expected created admin user")
	}

	users, err := authRepo.ListUsers(ctx)
	if err != nil {
		t.Fatalf("ListUsers() error = %v", err)
	}
	if len(users) < 2 {
		t.Fatalf("expected at least 2 users, got %d", len(users))
	}

	var scopedUser *domainauth.User
	for index := range users {
		if users[index].Username == "scoped-user" {
			scopedUser = &users[index]
			break
		}
	}
	if scopedUser == nil {
		t.Fatalf("expected scoped-user in %+v", users)
	}
	if len(scopedUser.DirectDeviceGroups) != 1 || scopedUser.DirectDeviceGroups[0].Name != "Warehouse B" {
		t.Fatalf("expected direct Warehouse B group, got %+v", scopedUser.DirectDeviceGroups)
	}
	if scopedUser.EffectiveDeviceGroupCount != 2 {
		t.Fatalf("expected 2 effective groups, got %d", scopedUser.EffectiveDeviceGroupCount)
	}
	if scopedUser.EffectiveDeviceCount != 2 {
		t.Fatalf("expected access to 2 devices, got %d", scopedUser.EffectiveDeviceCount)
	}
}

func TestDeviceGroupRepositoryInternalGroupIsHiddenFromOptionsAndDeviceSummaries(t *testing.T) {
	db := newTestDB(t)
	authRepo := NewAuthRepository(db)
	deviceRepo := NewDeviceRepository(db)
	groupRepo := NewDeviceGroupRepository(db)
	ctx := context.Background()

	adminRole, err := authRepo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	adminUser, err := authRepo.CreateUser(ctx, "bootstrap-admin", "hash", "salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	if adminUser == nil {
		t.Fatal("expected admin user")
	}

	internalGroups, err := authRepo.GetDirectDeviceGroupsForUser(ctx, adminUser.ID)
	if err != nil {
		t.Fatalf("GetDirectDeviceGroupsForUser() error = %v", err)
	}
	if len(internalGroups) != 1 || internalGroups[0].Name != internalAllDevicesGroupName || !internalGroups[0].IsInternal {
		t.Fatalf("expected bootstrap admin to receive internal group, got %+v", internalGroups)
	}

	device := &domaindevice.Device{
		Name:      "Scoped Device",
		Serial:    "scoped-serial",
		Status:    "online",
		LastSeen:  time.Now().UTC(),
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	if err := deviceRepo.Insert(ctx, device); err != nil {
		t.Fatalf("Insert() error = %v", err)
	}

	internalOnlyGroups, err := groupRepo.GetGroupsForDevice(ctx, device.ID)
	if err != nil {
		t.Fatalf("GetGroupsForDevice() error = %v", err)
	}
	if len(internalOnlyGroups) != 0 {
		t.Fatalf("expected internal group to be hidden from device summaries, got %+v", internalOnlyGroups)
	}

	options, err := groupRepo.ListOptions(ctx, "")
	if err != nil {
		t.Fatalf("ListOptions() error = %v", err)
	}
	for _, option := range options {
		if option.Name == internalAllDevicesGroupName || option.IsInternal {
			t.Fatalf("expected internal group to be hidden from options, got %+v", options)
		}
	}
}

func TestDeviceGroupRepositoryStrictAccessRequiresMatchingGroup(t *testing.T) {
	db := newTestDB(t)
	authRepo := NewAuthRepository(db)
	deviceRepo := NewDeviceRepository(db)
	groupRepo := NewDeviceGroupRepository(db)
	ctx := context.Background()

	viewerRole, err := authRepo.CreateRole(ctx, "Viewer", "Scoped viewer", []string{"devices.view"}, nil)
	if err != nil {
		t.Fatalf("CreateRole() error = %v", err)
	}
	businessGroup, err := groupRepo.Create(ctx, "Warehouse Scope", "Business scope")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	device := &domaindevice.Device{
		Name:      "Scoped Device",
		Serial:    "scoped-device",
		Status:    "online",
		LastSeen:  time.Now().UTC(),
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	if err := deviceRepo.Insert(ctx, device); err != nil {
		t.Fatalf("Insert() error = %v", err)
	}
	if err := groupRepo.SetGroupsForDevice(ctx, device.ID, []int{businessGroup.ID}); err != nil {
		t.Fatalf("SetGroupsForDevice() error = %v", err)
	}

	userWithoutGroups, err := authRepo.CreateUser(ctx, "no-scope-user", "hash", "salt", []int{viewerRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser(no-scope-user) error = %v", err)
	}
	if userWithoutGroups == nil {
		t.Fatal("expected no-scope user")
	}

	visibleDeviceIDs, err := groupRepo.ListAccessibleDeviceIDs(ctx, userWithoutGroups.ID)
	if err != nil {
		t.Fatalf("ListAccessibleDeviceIDs(no-scope-user) error = %v", err)
	}
	if len(visibleDeviceIDs) != 0 {
		t.Fatalf("expected no devices for user without groups, got %+v", visibleDeviceIDs)
	}
	canAccess, err := groupRepo.CanUserAccessDevice(ctx, userWithoutGroups.ID, device.ID)
	if err != nil {
		t.Fatalf("CanUserAccessDevice(no-scope-user) error = %v", err)
	}
	if canAccess {
		t.Fatal("expected user without groups to be denied")
	}

	internalGroup, err := groupRepo.GetByName(ctx, internalAllDevicesGroupName)
	if err != nil {
		t.Fatalf("GetByName(internal) error = %v", err)
	}
	if internalGroup == nil {
		t.Fatal("expected internal all-devices group")
	}

	userWithAllDevices, err := authRepo.CreateUser(ctx, "all-scope-user", "hash", "salt", []int{viewerRole.ID}, []int{internalGroup.ID})
	if err != nil {
		t.Fatalf("CreateUser(all-scope-user) error = %v", err)
	}
	if userWithAllDevices == nil {
		t.Fatal("expected all-scope user")
	}

	visibleDeviceIDs, err = groupRepo.ListAccessibleDeviceIDs(ctx, userWithAllDevices.ID)
	if err != nil {
		t.Fatalf("ListAccessibleDeviceIDs(all-scope-user) error = %v", err)
	}
	if len(visibleDeviceIDs) != 1 || visibleDeviceIDs[0] != device.ID {
		t.Fatalf("expected all-scope user to see all devices, got %+v", visibleDeviceIDs)
	}
	canAccess, err = groupRepo.CanUserAccessDevice(ctx, userWithAllDevices.ID, device.ID)
	if err != nil {
		t.Fatalf("CanUserAccessDevice(all-scope-user) error = %v", err)
	}
	if !canAccess {
		t.Fatal("expected user with internal all-devices group to be allowed")
	}
}

func TestDeviceGroupRepositoryListOptionsForUserOnlyReturnsAssignedBusinessGroups(t *testing.T) {
	db := newTestDB(t)
	authRepo := NewAuthRepository(db)
	groupRepo := NewDeviceGroupRepository(db)
	ctx := context.Background()

	viewerRole, err := authRepo.CreateRole(ctx, "Scoped Options Viewer", "Scoped options viewer", []string{"devices.view"}, nil)
	if err != nil {
		t.Fatalf("CreateRole() error = %v", err)
	}

	assignedGroup, err := groupRepo.Create(ctx, "Assigned Group", "Visible to current user")
	if err != nil {
		t.Fatalf("Create(assigned) error = %v", err)
	}
	if _, err := groupRepo.Create(ctx, "Hidden Group", "Should not leak"); err != nil {
		t.Fatalf("Create(hidden) error = %v", err)
	}

	user, err := authRepo.CreateUser(ctx, "scoped-options-user", "hash", "salt", []int{viewerRole.ID}, []int{assignedGroup.ID})
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	if user == nil {
		t.Fatal("expected scoped-options-user to be created")
	}

	options, err := groupRepo.ListOptionsForUser(ctx, user.ID, "")
	if err != nil {
		t.Fatalf("ListOptionsForUser() error = %v", err)
	}
	if len(options) != 1 {
		t.Fatalf("expected exactly one visible option, got %+v", options)
	}
	if options[0].Name != assignedGroup.Name {
		t.Fatalf("expected visible option %q, got %+v", assignedGroup.Name, options)
	}
	if options[0].IsInternal {
		t.Fatalf("expected business group option, got internal %+v", options[0])
	}
}

func TestAuthRepositoryListRolesHydratesPermissionsAndDeviceGroups(t *testing.T) {
	db := newTestDB(t)
	authRepo := NewAuthRepository(db)
	groupRepo := NewDeviceGroupRepository(db)
	ctx := context.Background()

	group, err := groupRepo.Create(ctx, "Testing Group", "Testing devices")
	if err != nil {
		t.Fatalf("Create() group error = %v", err)
	}

	role, err := authRepo.CreateRole(ctx, "QA Operator", "QA role", []string{"devices.view", "devices.control"}, []int{group.ID})
	if err != nil {
		t.Fatalf("CreateRole() error = %v", err)
	}
	if role == nil {
		t.Fatal("expected created role")
	}

	roles, err := authRepo.ListRoles(ctx)
	if err != nil {
		t.Fatalf("ListRoles() error = %v", err)
	}

	var qaRole *domainauth.Role
	for index := range roles {
		if roles[index].ID == role.ID {
			qaRole = &roles[index]
			break
		}
	}
	if qaRole == nil {
		t.Fatalf("expected QA Operator role in %+v", roles)
	}
	if len(qaRole.Permissions) != 2 {
		t.Fatalf("expected 2 permissions, got %+v", qaRole.Permissions)
	}
	if len(qaRole.DeviceGroups) != 1 || qaRole.DeviceGroups[0].Name != "Testing Group" {
		t.Fatalf("expected Testing Group device scope, got %+v", qaRole.DeviceGroups)
	}

	roleByName, err := authRepo.GetRoleByName(ctx, "qa operator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	if roleByName == nil || len(roleByName.DeviceGroups) != 1 || roleByName.DeviceGroups[0].ID != group.ID {
		t.Fatalf("expected hydrated role by name, got %+v", roleByName)
	}
}

func TestAuthRepositoryCreateSessionAndCleanupExpiredTokens(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	createdUser, err := repo.CreateUser(ctx, "session-user", "hash", "salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	record, err := repo.GetUserByID(ctx, createdUser.ID)
	if err != nil {
		t.Fatalf("GetUserByID() error = %v", err)
	}
	if record == nil {
		t.Fatal("expected created user record")
	}

	expiredPair := domainauth.TokenPair{
		AccessToken:           "expired-access",
		AccessTokenExpiresAt:  time.Now().UTC().Add(-time.Hour),
		RefreshToken:          "expired-refresh",
		RefreshTokenExpiresAt: time.Now().UTC().Add(-time.Hour),
	}
	if err := repo.CreateSession(ctx, *record, expiredPair); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}

	if got := countRows(t, db, `SELECT COUNT(*) FROM AccessTokens`); got != 1 {
		t.Fatalf("expected 1 access token before cleanup, got %d", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM RefreshTokens`); got != 1 {
		t.Fatalf("expected 1 refresh token before cleanup, got %d", got)
	}

	if err := repo.CleanupExpiredTokens(ctx, time.Now().UTC()); err != nil {
		t.Fatalf("CleanupExpiredTokens() error = %v", err)
	}

	if got := countRows(t, db, `SELECT COUNT(*) FROM AccessTokens`); got != 0 {
		t.Fatalf("expected 0 access tokens after cleanup, got %d", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM RefreshTokens`); got != 0 {
		t.Fatalf("expected 0 refresh tokens after cleanup, got %d", got)
	}
}

func TestAuthRepositoryTokenRevocationAndDeletion(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	user, err := repo.CreateUser(ctx, "token-user", "hash", "salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	record, err := repo.GetUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUserByID() error = %v", err)
	}

	pair := domainauth.TokenPair{
		AccessToken:           "live-access-token",
		AccessTokenExpiresAt:  time.Now().UTC().Add(time.Hour),
		RefreshToken:          "live-refresh-token",
		RefreshTokenExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	if err := repo.CreateSession(ctx, *record, pair); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}

	refreshRecord, _, err := repo.GetRefreshToken(ctx, hashToken(pair.RefreshToken))
	if err != nil {
		t.Fatalf("GetRefreshToken() error = %v", err)
	}
	if refreshRecord == nil {
		t.Fatal("expected refresh token record")
	}

	revokedAt := time.Now().UTC()
	if err := repo.RevokeRefreshToken(ctx, refreshRecord.ID, revokedAt); err != nil {
		t.Fatalf("RevokeRefreshToken() error = %v", err)
	}
	revokedRecord, _, err := repo.GetRefreshToken(ctx, hashToken(pair.RefreshToken))
	if err != nil {
		t.Fatalf("GetRefreshToken() after revoke error = %v", err)
	}
	if revokedRecord == nil || revokedRecord.RevokedAt == nil {
		t.Fatalf("expected revoked refresh token, got %+v", revokedRecord)
	}

	if err := repo.DeleteAccessTokenByHash(ctx, hashToken(pair.AccessToken)); err != nil {
		t.Fatalf("DeleteAccessTokenByHash() error = %v", err)
	}
	accessIdentity, _, err := repo.GetAccessTokenIdentity(ctx, hashToken(pair.AccessToken))
	if err != nil {
		t.Fatalf("GetAccessTokenIdentity() after delete error = %v", err)
	}
	if accessIdentity != nil {
		t.Fatalf("expected deleted access token to be absent, got %+v", accessIdentity)
	}
}

func TestAuthRepositoryRevokeAndDeleteAllTokensForUser(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	user, err := repo.CreateUser(ctx, "all-token-user", "hash", "salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	record, err := repo.GetUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUserByID() error = %v", err)
	}

	for index := range 2 {
		pair := domainauth.TokenPair{
			AccessToken:           "access-token-" + string(rune('A'+index)),
			AccessTokenExpiresAt:  time.Now().UTC().Add(time.Hour),
			RefreshToken:          "refresh-token-" + string(rune('A'+index)),
			RefreshTokenExpiresAt: time.Now().UTC().Add(time.Hour),
		}
		if err := repo.CreateSession(ctx, *record, pair); err != nil {
			t.Fatalf("CreateSession() #%d error = %v", index, err)
		}
	}

	if got := countRows(t, db, `SELECT COUNT(*) FROM AccessTokens WHERE UserId = ?`, user.ID); got != 2 {
		t.Fatalf("expected 2 access tokens before delete-all, got %d", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM RefreshTokens WHERE UserId = ? AND RevokedAt IS NULL`, user.ID); got != 2 {
		t.Fatalf("expected 2 active refresh tokens before revoke-all, got %d", got)
	}

	if err := repo.RevokeAllRefreshTokensForUser(ctx, user.ID); err != nil {
		t.Fatalf("RevokeAllRefreshTokensForUser() error = %v", err)
	}
	if err := repo.DeleteAllAccessTokensForUser(ctx, user.ID); err != nil {
		t.Fatalf("DeleteAllAccessTokensForUser() error = %v", err)
	}

	if got := countRows(t, db, `SELECT COUNT(*) FROM AccessTokens WHERE UserId = ?`, user.ID); got != 0 {
		t.Fatalf("expected 0 access tokens after delete-all, got %d", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM RefreshTokens WHERE UserId = ? AND RevokedAt IS NULL`, user.ID); got != 0 {
		t.Fatalf("expected 0 active refresh tokens after revoke-all, got %d", got)
	}
}

func TestAuthRepositoryUpdateUserPasswordAndRevokeSessions(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	user, err := repo.CreateUser(ctx, "password-rotate-user", "old-hash", "old-salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	record, err := repo.GetUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUserByID() error = %v", err)
	}

	pair := domainauth.TokenPair{
		AccessToken:           "password-rotate-access",
		AccessTokenExpiresAt:  time.Now().UTC().Add(time.Hour),
		RefreshToken:          "password-rotate-refresh",
		RefreshTokenExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	if err := repo.CreateSession(ctx, *record, pair); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}

	if err := repo.UpdateUserPasswordAndRevokeSessions(ctx, user.ID, "new-hash", "new-salt"); err != nil {
		t.Fatalf("UpdateUserPasswordAndRevokeSessions() error = %v", err)
	}

	updatedRecord, err := repo.GetUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUserByID() after password update error = %v", err)
	}
	if updatedRecord == nil || updatedRecord.PasswordHash != "new-hash" || updatedRecord.PasswordSalt != "new-salt" {
		t.Fatalf("expected password update to persist, got %+v", updatedRecord)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM AccessTokens WHERE UserId = ?`, user.ID); got != 0 {
		t.Fatalf("expected 0 access tokens after password rotation, got %d", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM RefreshTokens WHERE UserId = ? AND RevokedAt IS NULL`, user.ID); got != 0 {
		t.Fatalf("expected 0 active refresh tokens after password rotation, got %d", got)
	}
}

func TestAuthRepositoryUpdateUserAndRevokeSessions(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	user, err := repo.CreateUser(ctx, "disable-user", "hash", "salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	record, err := repo.GetUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUserByID() error = %v", err)
	}

	pair := domainauth.TokenPair{
		AccessToken:           "disable-access",
		AccessTokenExpiresAt:  time.Now().UTC().Add(time.Hour),
		RefreshToken:          "disable-refresh",
		RefreshTokenExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	if err := repo.CreateSession(ctx, *record, pair); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}

	updatedUser, err := repo.UpdateUserAndRevokeSessions(ctx, user.ID, "disable-user", false, []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("UpdateUserAndRevokeSessions() error = %v", err)
	}
	if updatedUser == nil || updatedUser.IsActive {
		t.Fatalf("expected disabled user, got %+v", updatedUser)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM AccessTokens WHERE UserId = ?`, user.ID); got != 0 {
		t.Fatalf("expected 0 access tokens after disabling user, got %d", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM RefreshTokens WHERE UserId = ? AND RevokedAt IS NULL`, user.ID); got != 0 {
		t.Fatalf("expected 0 active refresh tokens after disabling user, got %d", got)
	}
}

func TestDeviceRepositoryInsertFindAndDelete(t *testing.T) {
	db := newTestDB(t)
	repo := NewDeviceRepository(db)
	ctx := context.Background()

	ip := "192.168.0.10"
	port := 5555
	now := time.Now().UTC()
	device := &domaindevice.Device{
		Name:      "Pixel",
		Serial:    "192.168.0.10:5555",
		IPAddress: &ip,
		Port:      &port,
		Status:    "online",
		LastSeen:  now,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := repo.Insert(ctx, device); err != nil {
		t.Fatalf("Insert() error = %v", err)
	}
	if device.ID == 0 {
		t.Fatal("expected inserted device id to be assigned")
	}

	found, err := repo.FindBySerialOrAddress(ctx, device.Serial, device.IPAddress, device.Port)
	if err != nil {
		t.Fatalf("FindBySerialOrAddress() error = %v", err)
	}
	if found == nil || found.ID != device.ID {
		t.Fatalf("expected to find inserted device, got %+v", found)
	}

	if err := repo.Delete(ctx, device.ID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	deleted, err := repo.GetByID(ctx, device.ID)
	if err != nil {
		t.Fatalf("GetByID() after delete error = %v", err)
	}
	if deleted != nil {
		t.Fatalf("expected deleted device to be nil, got %+v", deleted)
	}
}

func TestDeviceSettingsRepositoryDefaultsAndRoundTrip(t *testing.T) {
	db := newTestDB(t)
	repo := NewDeviceSettingsRepository(db)
	ctx := context.Background()

	defaults, err := repo.GetBySerial(ctx, "missing-serial")
	if err != nil {
		t.Fatalf("GetBySerial() missing error = %v", err)
	}
	if defaults.VideoCodec != domaindevice.DefaultSettingsProfile().VideoCodec {
		t.Fatalf("expected default settings profile, got %+v", defaults)
	}

	profile := domaindevice.DefaultSettingsProfile()
	profile.VideoCodec = "h265"
	profile.Video = false

	saved, err := repo.SaveBySerial(ctx, "serial-1", profile)
	if err != nil {
		t.Fatalf("SaveBySerial() error = %v", err)
	}
	if saved.VideoCodec != "h265" {
		t.Fatalf("expected saved codec h265, got %s", saved.VideoCodec)
	}

	loaded, err := repo.GetBySerial(ctx, "serial-1")
	if err != nil {
		t.Fatalf("GetBySerial() loaded error = %v", err)
	}
	if loaded.VideoCodec != "h265" || loaded.Video != false {
		t.Fatalf("expected saved settings to round-trip, got %+v", loaded)
	}

	if err := repo.DeleteBySerial(ctx, "serial-1"); err != nil {
		t.Fatalf("DeleteBySerial() error = %v", err)
	}
	afterDelete, err := repo.GetBySerial(ctx, "serial-1")
	if err != nil {
		t.Fatalf("GetBySerial() after delete error = %v", err)
	}
	if afterDelete.VideoCodec != domaindevice.DefaultSettingsProfile().VideoCodec {
		t.Fatalf("expected defaults after delete, got %+v", afterDelete)
	}
}
