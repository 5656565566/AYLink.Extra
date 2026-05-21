# =============================================================================
#  项目配置
# =============================================================================
# 项目名称
PROJECT_NAME := $(shell basename $(CURDIR))

# 构建产物路径
BUILD_PATH   := ./bin

# 源文件路径
AGENT_PATH      := ./AYLink.Agent
WEB_PATH        := ./AYLink.Web

# 可执行文件名称
AGENT_BINARY_NAME := AYLink-Agent


# =============================================================================
#  编译环境与工具链
# =============================================================================
GO := go
NPM := npm

# 编译模式 release (默认 优化大小) debug (包含调试信息)
BUILD_MODE ?= release


# =============================================================================
#  编译标志 (LDFLAGS)
# =============================================================================
# -s 移除符号表
# -w 移除 DWARF 调试信息
LDFLAGS_RELEASE := -s -w
LDFLAGS_DEBUG   :=

# 根据 BUILD_MODE 选择 LDFLAGS
ifeq ($(BUILD_MODE), release)
    LDFLAGS_VALUES := $(LDFLAGS_RELEASE)
else
    LDFLAGS_VALUES := $(LDFLAGS_DEBUG)
endif

# 统一的 LDFLAGS
LDFLAGS := -ldflags="$(LDFLAGS_VALUES)"


# =============================================================================
#  平台定义
# =============================================================================
# 目标编译平台
PLATFORMS_EXE := windows/amd64 windows/arm64 linux/amd64 linux/arm64 darwin/amd64 darwin/arm64


.PHONY: all build web agent clean run help

# =============================================================================
#  主要构建目标
# =============================================================================
all: agent

build: all

# 构建前端 Web 项目并拷贝至 Agent 嵌入目录
web:
	@echo "==> Building Web project..."
	@cd $(WEB_PATH) && $(NPM) install
	@cd $(WEB_PATH) && $(NPM) run build
	@echo "==> Web project build complete. Output directory: $(AGENT_PATH)/www"

# 构建所有平台的 Agent 可执行文件 (依赖 Web 构建)
agent: web
	@echo "==> Building Agent for all target platforms (Mode $(BUILD_MODE))..."
	@mkdir -p $(BUILD_PATH)
	@$(foreach platform, $(PLATFORMS_EXE), $(call build_exe_platform, $(platform), $(AGENT_PATH)/cmd/agent, $(AGENT_BINARY_NAME)))
	@echo "==> Agent executables build complete."


# =============================================================================
#  辅助目标
# =============================================================================
run: web
	@echo "==> Web assets prepared for go:embed."
	@echo "==> Running Agent locally..."
	@cd $(AGENT_PATH) && $(GO) run ./cmd/agent/main.go

clean:
	@echo "==> Cleaning build artifacts..."
	@rm -rf $(BUILD_PATH)
	@rm -rf $(AGENT_PATH)/www
	@rm -rf $(WEB_PATH)/node_modules
	@echo "==> Clean complete."

help:
	@echo "Usage: make [target] [BUILD_MODE=release|debug]"
	@echo ""
	@echo "Main Targets:"
	@echo "  all          (Default) Build Web and Agent executables for all platforms."
	@echo "  build        Alias for 'all'."
	@echo "  web          Build frontend Web project and copy to Agent embedded directory."
	@echo "  agent        Build Agent executables for all target platforms (depends on web)."
	@echo ""
	@echo "Auxiliary Targets:"
	@echo "  run          Compile and run the Agent locally."
	@echo "  clean        Remove all build artifacts and node_modules."
	@echo ""
	@echo "Options:"
	@echo "  BUILD_MODE   Set to 'release' (default) for smaller files or 'debug' for debug info."
	@echo ""
	@echo "Example:"
	@echo "  make agent                    # Build all agent executables with release optimization."
	@echo "  make agent BUILD_MODE=debug   # Build all agent executables with debug information."


# =============================================================================
#  内部编译宏 (PRIVATE)
# =============================================================================

# 编译可执行文件的宏
# $(1): 平台 (e.g. windows/amd64)
# $(2): 源文件路径 (未使用, 统一在内层 cd 进去处理)
# $(3): 输出二进制文件名 (e.g. AYLink-Agent)
define build_exe_platform
	$(eval GOOS := $(word 1, $(subst /, ,$1)))
	$(eval GOARCH := $(word 2, $(subst /, ,$1)))
	$(eval BIN_NAME := $3)
	$(eval SUFFIX := $(if $(filter windows,$(GOOS)),.exe,))
	$(eval OUTPUT_NAME := $(CURDIR)/$(BUILD_PATH)/$(BIN_NAME)-$(GOOS)-$(GOARCH)$(SUFFIX))

	@echo "--> Building $(BIN_NAME) for $(GOOS)/$(GOARCH)..."
	@cd $(AGENT_PATH) && env CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) $(GO) build $(LDFLAGS) -o "$(OUTPUT_NAME)" ./cmd/agent
endef
