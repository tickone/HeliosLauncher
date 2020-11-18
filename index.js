// Requirements
const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron')
const autoUpdater = require('electron-updater').autoUpdater
const isDev = require('./app/assets/js/isdev')
const path = require('path')
const semver = require('semver')
const url = require('url')
const os = require('os')
const axios = require('axios')
const bplist = require('bplist-parser')
const ejse = require('ejs-electron')

// Setup auto updater.
function initAutoUpdater(event, data) {

    if (data) {
        autoUpdater.allowPrerelease = true
    } else {
        // Defaults to true if application version contains prerelease components (e.g. 0.12.1-alpha.1)
        // autoUpdater.allowPrerelease = true
    }

    if (isDev) {
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
    }
    if (process.platform === 'darwin') {
        autoUpdater.autoDownload = false
    }
    autoUpdater.on('update-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-available', info)
    })
    autoUpdater.on('update-downloaded', (info) => {
        event.sender.send('autoUpdateNotification', 'update-downloaded', info)
    })
    autoUpdater.on('update-not-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-not-available', info)
    })
    autoUpdater.on('checking-for-update', () => {
        event.sender.send('autoUpdateNotification', 'checking-for-update')
    })
    autoUpdater.on('error', (err) => {
        event.sender.send('autoUpdateNotification', 'realerror', err)
    })
}

// Open channel to listen for update actions.
ipcMain.on('autoUpdateAction', (event, arg, data) => {
    switch (arg) {
        case 'initAutoUpdater':
            console.log('Initializing auto updater.')
            initAutoUpdater(event, data)
            event.sender.send('autoUpdateNotification', 'ready')
            break
        case 'checkForUpdate':
            autoUpdater.checkForUpdates()
                .catch(err => {
                    event.sender.send('autoUpdateNotification', 'realerror', err)
                })
            break
        case 'allowPrereleaseChange':
            if (!data) {
                const preRelComp = semver.prerelease(app.getVersion())
                if (preRelComp != null && preRelComp.length > 0) {
                    autoUpdater.allowPrerelease = true
                } else {
                    autoUpdater.allowPrerelease = data
                }
            } else {
                autoUpdater.allowPrerelease = data
            }
            break
        case 'installUpdateNow':
            autoUpdater.quitAndInstall()
            break
        default:
            console.log('Unknown argument', arg)
            break
    }
})
// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    event.sender.send('distributionIndexDone', res)
})

// Disable hardware acceleration.
// https://electronjs.org/docs/tutorial/offscreen-rendering
app.disableHardwareAcceleration()

// https://github.com/electron/electron/issues/18397
app.allowRendererProcessReuse = true

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

function createWindow() {

    win = new BrowserWindow({
        width: 980,
        height: 552,
        icon: getPlatformIcon('profile-new-01'),
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: '#171614'
    })

    win.loadURL(url.format({
        pathname: path.join(__dirname, 'app', 'app.ejs'),
        protocol: 'file:',
        slashes: true
    }))

    // prevent developer tool
    // win.webContents.on('devtools-opened', () => { win.webContents.closeDevTools() })

    // // open devtool
    // win.webContents.openDevTools()

    /*win.once('ready-to-show', () => {
        win.show()
    })*/

    const [cpu] = os.cpus()
    const { model } = cpu
    if (process.platform === 'darwin') {
        bplist
            .parseFile(`${process.env.HOME}/Library/Preferences/com.apple.SystemProfiler.plist`)
            .then(plist => {
                const type = plist[0]['CPU Names'][Object.keys(plist[0]['CPU Names'])[0]]
                const [year] = type.match(/\d{4}/) || []
                const [, intel] = model.match(/i(\d)/) || []

                if (type.includes('MacBook Pro')) {
                    if (year <= 2014 && intel < 5) {
                        dialog.showMessageBoxSync({ message: 'Your hardware is not recommended to play minecraft. Macbook Pro must be greater or equal to 2014 model, Intel i5 CPU' })
                    }
                } else if (type.includes('MacBook Air')) {
                    if (year < 2017) {
                        dialog.showMessageBoxSync({ message: 'Your hardware is not recommended to play minecraft. Macbook Air must be greater than 2017 model.' })
                    } else {
                        dialog.showMessageBoxSync({ message: 'We do not recommend you use Macbook Air to play minecraft.' })
                    }
                } else if (type.includes('MacBook')) {
                    if (year <= 2015 && intel < 5) {
                        dialog.showMessageBoxSync({ message: 'Your hardware is not recommended to play minecraft.' })
                    }
                }
            })
    } else if (process.platform === 'win32') {
        const cpuinfo = model
            .match(/[A-Za-z]{2,}|i\d+-\d{3,}[A-Z]*/ig)
            .filter(value => {
                const forbidden = [
                    'TM',
                    'CPU',
                    'GHz',
                    'Core'
                ]

                return !forbidden.includes(value)
            })

        axios
            .get('https://browser.geekbench.com/processor-benchmarks.json')
            .then(response => {
                const devices = response.data.devices

                const cputype = devices.find(device => {
                    const name = device.name

                    return cpuinfo.every(value => name.includes(value))
                })

                if (cputype && cputype.score < 745) {
                    dialog.showMessageBoxSync({ message: 'Your hardware is not recommended to play minecraft.' })
                } else if (os.totalmem() / (1024 ** 3) < 8) {
                    dialog.showMessageBoxSync({ message: 'Your hardware is not recommended to play minecraft. (memory is less than 8GB)' })
                }
            })
    }

    win.removeMenu()

    win.resizable = true

    win.on('closed', () => {
        win = null
    })
}

function createMenu() {

    if (process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'Application',
            submenu: [{
                label: 'About Application',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Edit',
            submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }

}

function getPlatformIcon(filename) {
    let ext
    switch (process.platform) {
        case 'win32':
            ext = 'ico'
            break
        case 'darwin':
        case 'linux':
        default:
            ext = 'png'
            break
    }

    return path.join(__dirname, 'app', 'assets', 'images', `${filename}.${ext}`)
}

app.on('ready', createWindow)
app.on('ready', createMenu)

app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})
