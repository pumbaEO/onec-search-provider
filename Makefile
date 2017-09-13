UUID=onec-search-provider@evhen.sosna.gmail.com
INSTALL_PATH=~/.local/share/gnome-shell/extensions/$(UUID)
ZIP_PATH=$(UUID).zip
SRC_PATH=src

$(ZIP_PATH):
	cd $(SRC_PATH) && \
	zip -r -u ../$(ZIP_PATH) .

install: $(ZIP_PATH)
	mkdir -p $(INSTALL_PATH) && \
	unzip -o $(ZIP_PATH) -d $(INSTALL_PATH)

uninstall:
	rm $(INSTALL_PATH) -rf

clean:
	rm -f $(UUID).zip
