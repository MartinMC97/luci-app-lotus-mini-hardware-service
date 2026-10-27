include $(TOPDIR)/rules.mk
PKG_NAME:=luci-app-lotus-mini-hardware-service
PKG_VERSION:=0.1.0
PKG_RELEASE:=5
PKG_LICENSE:=GPL-3.0-only
PKG_BUILD_DEPENDS:=lotus-hardware-service luci-base/host
PKG_FILE_DEPENDS:=$(CURDIR)/src $(CURDIR)/root $(CURDIR)/po
include $(INCLUDE_DIR)/package.mk
define Package/luci-app-lotus-mini-hardware-service
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI local hardware service dashboard for Lotus Mini
  DEPENDS:=+luci-base +rpcd +lotus-hardware-service
endef
define Build/Prepare
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(CP) ./src/backend.cpp $(PKG_BUILD_DIR)/
endef
define Build/Compile
	$(TARGET_CXX) $(TARGET_CPPFLAGS) $(TARGET_CXXFLAGS) -std=c++17 -Wall -Wextra -Werror -isystem $(STAGING_DIR)/usr/include/lotus-hardware $(PKG_BUILD_DIR)/backend.cpp -pthread $(TARGET_LDFLAGS) -o $(PKG_BUILD_DIR)/lotus_hardware
	$(STAGING_DIR_HOSTPKG)/bin/po2lmo $(CURDIR)/po/zh_Hans/lotus-mini-hardware-service.po $(PKG_BUILD_DIR)/lotus-mini-hardware-service.zh-cn.lmo
endef
define Package/luci-app-lotus-mini-hardware-service/install
	$(CP) ./root/* $(1)/
	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/lotus_hardware $(1)/usr/libexec/rpcd/
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/lotus-mini-hardware-service.zh-cn.lmo $(1)/usr/lib/lua/luci/i18n/
	$(INSTALL_DIR) $(1)/usr/share/doc/luci-app-lotus-mini-hardware-service
	$(INSTALL_DATA) ./LICENSE ./NOTICE $(1)/usr/share/doc/luci-app-lotus-mini-hardware-service/
	chmod 755 $(1)/usr/libexec/lotus-hardware-ui-menu
endef
define Package/luci-app-lotus-mini-hardware-service/postinst
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ]; then
  /usr/libexec/lotus-hardware-ui-menu install
  /etc/init.d/rpcd reload >/dev/null 2>&1 || true
fi
exit 0
endef
define Package/luci-app-lotus-mini-hardware-service/prerm
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ] && [ "$$PKG_UPGRADE" != 1 ]; then
  /usr/libexec/lotus-hardware-ui-menu restore
fi
exit 0
endef
$(eval $(call BuildPackage,luci-app-lotus-mini-hardware-service))
