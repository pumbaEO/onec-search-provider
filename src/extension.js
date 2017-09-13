/* OneC Search Provider for Gnome Shell
 *
 * Copyright (c) 2017 Evhen Sosna
 *
 * This programm is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or
 * (at your option) any later version.
 *
 * This programm is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Search = imports.ui.search;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Util = imports.misc.util;
const IconGrid = imports.ui.iconGrid;


// OneCSearchProvider holds the instance of the search provider
// implementation. If null, the extension is either uninitialized
// or has been disabled via disable().
var onecSearchProvider = null;

// try to find the default terminal app. fallback is gnome-terminal
function getDefaultOneC() {
    let exec = "/opt/1C/v8.3/x86_64/1cv8";
    try{
        filename = GLib.build_filenamev(['/opt', '1C', 'v8.3', 'x86_64', '1cv8']);
        if (Gio.File.new_for_path(filename).query_exists(null)){
            exec = filename;
        } else {
            exec = GLib.build_filenamev(['/opt', '1C', 'v8.3', 'i386', '1cv8']);
        }
    } catch (err) {
        exec = "/opt/1C/v8.3/x86_64/1cv8";
    }
    return {
        'exec': exec,
        'args':'/IBName'}
}

let desktopAppInfo = Gio.DesktopAppInfo.new("1cestart.desktop");

let onecIcon;

if (desktopAppInfo !== null) {
    onecIcon = desktopAppInfo.get_icon();
}

const OneCSearchProvider = new Lang.Class({
    Name: '1C search provider',
    Extends: Search.SearchProvider,

    _init: function() {

        let filename = '';
        let terminal_definition = {};
        this.id = "OneCSearchProvider";
        this.title = "1C Search";
        this.searchSystem = null;
        this._knownBases = [];

        this.appInfo = {
            get_name: function () { return 'onec-search-provider'; },
            get_icon: function () { return onecIcon; },
            get_id: function () { return this.id; }
          };

        // init for ~/.1C/1cestart/ibases.v8i
        filename = GLib.build_filenamev([GLib.get_home_dir(), '/.1C/', '1cestart', 'ibases.v8i']);
        let configFile = Gio.file_new_for_path(filename);
        this.configMonitor = configFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this.configMonitor.connect('changed', Lang.bind(this, this._onConfigChanged));
        this._onConfigChanged(null, configFile, null, Gio.FileMonitorEvent.CREATED);
        
        this._mode = "DESIGNER";
    },

    _onConfigChanged: function(filemonitor, file, other_file, event_type) {
        if (!file.query_exists (null)) {
            this._knownBases = [];
            return;
        }

        if (event_type == Gio.FileMonitorEvent.CREATED ||
            event_type == Gio.FileMonitorEvent.CHANGED ||
            event_type == Gio.FileMonitorEvent.CHANGES_DONE_HINT)
        {
            this._knownBases = [];

            // read hostnames if ssh-config file is created or changed
            let content = file.load_contents(null);
            let filelines = String(content[1]).trim().split('\n');
            let d = []
            // search for all lines which begins with "host"
            for (var i=0; i<filelines.length; i++) {
            	let line = filelines[i];
                if (line.lastIndexOf('[', 0) == 0) {
                    let basename = line.replace('[', '').replace(']', '').trim();
                	if ((i+1 < filelines.length) && (filelines[i+1].lastIndexOf('Connect')==0)) {
                		this._knownBases.push({
                			'name': basename,
                			'connect': filelines[i+1].replace("Connect=", "").trim()
                			})
                	}
                }
        }
    }
    },

    createResultObject: function(result, terms, callback) {
        return null;
    },

    getResultMetas: function(resultIds, callback) {
        let metas = resultIds.map(this.getResultMeta, this);
        callback(metas);
    },

    getResultMeta: function(resultId) {
        let ibname = resultId;
        const result = this._knownBases.filter(function(res) {
            return res.name === resultId;
          })[0];
        return { 'id': resultId,
                 'name': ibname,
                 /*'createIcon': function(size) {
                        let xicon = new Gio.ThemedIcon({name: '1cestart'});
                        return new St.Icon({icon_size: size,
                                            gicon: xicon});
                 },*/
                 'createIcon': function(size){},
                 'description': "" + this._mode + " "+ result.connect,
                 'path': "path"+ibname
               };
    },

    activateResult: function(id) {
        let ibname = id;
        ibname = ibname.trim();
        let onec = getDefaultOneC();
        let terminal_args = onec.args.split(' ');
        let cmd = [onec.exec]
        cmd.push(this._mode);
        
        // add defined gsettings arguments, but remove --execute and -x
        for (var i=0; i<terminal_args.length; i++) {
            let arg = terminal_args[i];

            if (arg == '/IBName') {
                cmd.push(terminal_args[i]+ibname);
            } else {
                cmd.push(terminal_args[i]);
            }
        }

        // start terminal with ssh command
        Util.spawn(cmd);
    },

    filterResults: function(providerResults, maxResults) {
        maxMyResults = maxResults > 5 ? maxResults : 5
        return providerResults.slice(0, maxMyResults);
    },

    _removePrefix: function (terms) {
        let onec_prefix = '1';
        let onec_enterprise = '1e'
        if (terms[0] == onec_prefix) {
            this._mode = "DESIGNER";
            return terms.slice(1);
        } else if (terms[0] == onec_enterprise) {
            this._mode = "ENTERPRISE";
            return terms.slice(1);
        } else {
            return [];
        }
    },

    _getResultSet: function (sessions, terms) {
        let results = [];
        let weightarray = [];
        let weightkeys = {};
        let termsOnec = this._removePrefix(terms);
        if (termsOnec.length == 0){
            return [];
        }
        // search for terms ignoring case - create re's once only for
        // each term and make sure matches all terms
        let keysweight = [];
        let res = termsOnec.map(function (term) { return new RegExp(term, 'i'); });
        for (let i = 0; i < sessions.length; i++) {
            let session = sessions[i];
            let failed = false;
            let weight = 100;
            let weightconn = 20;
            for (let j = 0; !failed && j < res.length; j++) {
                let re = res[j];
                // search on name, protocol or the term remmina
                failed |= (session.name.search(re) < 0 &&
                           session.connect.search(re) < 0);
                if (!failed){
                    let namematch = session.name.match(re);
                    if (namematch!==null) {
                        weight = weight - 20;
                        if (namematch[0].length == session.name.length) {
                            weight = weight - 10;
                        } else {
                            weight = weight + 10;
                        }
                    }
                    weightconn = session.connect.search(re) < 0 ? -10 : 10;
                }
            }
            if (!failed) {
                summaryweight = weight + weightconn;
                if (!weightkeys[summaryweight]){
                    weightkeys[summaryweight] = [];
                    weightarray.push(summaryweight);
                }
                weightkeys[summaryweight].push(session.name);
                }
        }
        function isNumber (n) {
            return !isNaN(parseFloat(n)) && isFinite(n)
        }

        function cmp (a, b) {
            if (a === b) {
            return 0
            }
        
            if (isNumber(a) && isNumber(b)) {
            return parseFloat(a) < parseFloat(b) ? -1 : 1
            } else {
            return a < b ? -1 : 1
            }
        }
        
        weightarray = weightarray.sort(cmp);
        for (let k = 0; k<weightarray.length; k++){
            let key = weightarray[k];
            toresult = weightkeys[key];
            for (i in toresult){
                results.push(toresult[i]);
            }
        }
        return results;
    },

    getInitialResultSet: function(terms, callback) {
        let res = this._getResultSet(this._knownBases, terms);
        callback(res)
    },

    getSubsearchResultSet: function(previousResults, terms, callback) {
        let res = this._getResultSet(this._knownBases, terms);
        callback(res)
    },
});

function init() {
}

function enable() {
    if (!onecSearchProvider) {
        onecSearchProvider = new OneCSearchProvider();
        Main.overview.viewSelector._searchResults._registerProvider(onecSearchProvider);
        
    }
}

function disable() {
    if  (onecSearchProvider) {
        Main.overview.viewSelector._searchResults._unregisterProvider(onecSearchProvider);
        onecSearchProvider.configMonitor.cancel();
        onecSearchProvider = null;
    }
}
