// Хук electron-builder: выполняется после упаковки платформы, до создания
// инсталлятора/архива. На Windows встраиваем иконку и метаданные exe вручную,
// через чистый JS (resedit), а не через встроенный rcedit электрон-билдера —
// тот требует Wine на Linux-машинах без Wine (см. win.signAndEditExecutable:
// false в package.json, отключающее встроенный шаг rcedit/подписи).
// На настоящем Windows-раннере (GitHub Actions windows-latest) этот хук тоже
// отработает без проблем — resedit кроссплатформенный.
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const ResEdit = require('resedit');
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] exe не найден, пропускаю встраивание иконки:', exePath);
    return;
  }

  const data = fs.readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(data);
  const res = ResEdit.NtExecutableResource.from(exe);

  const icoPath = path.join(__dirname, '..', 'build', 'icon.ico');
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const existingGroups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = existingGroups.length ? existingGroups[0].id : 1;
  const lang = existingGroups.length ? existingGroups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, groupId, lang, iconFile.icons.map(i => i.data)
  );

  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (viList.length) {
    const vi = viList[0];
    const productName = context.packager.appInfo.productName;
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: productName,
      FileDescription: productName,
      CompanyName: 'WiseBase',
      OriginalFilename: exeName,
      InternalName: context.packager.appInfo.productFilename,
    });
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('[afterPack] Иконка и метаданные встроены в', exePath);
};
