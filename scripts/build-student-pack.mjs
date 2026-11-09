// 학생 테스트용 패키지(게임만 정적 빌드) 만들기:  node scripts/build-student-pack.mjs
// 결과: dist/student-pack/ (site/ + 실행 파일 + README) 와 dist/noryangjin-hunter-student-test.zip
// 게임 화면만 따로 빌드하므로 로그인/DB/API 가 필요 없고, 어떤 정적 호스팅에서도 동작한다.
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync, readFileSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = process.cwd()
const TMP = join(ROOT, '.student-build')
const DIST = join(ROOT, 'dist')
const PACK = join(DIST, 'student-pack')

rmSync(TMP, { recursive: true, force: true })
rmSync(PACK, { recursive: true, force: true })
mkdirSync(join(TMP, 'src/app'), { recursive: true })
mkdirSync(DIST, { recursive: true })

// 1) 게임에 필요한 것만 복사
cpSync(join(ROOT, 'src/components/game'), join(TMP, 'src/components/game'), { recursive: true })
cpSync(join(ROOT, 'src/game'), join(TMP, 'src/game'), { recursive: true })
cpSync(join(ROOT, 'public/hunter-assets'), join(TMP, 'public/hunter-assets'), { recursive: true })
mkdirSync(join(TMP, 'public/game-data'), { recursive: true })
copyFileSync(join(ROOT, 'public/game-data/questions.sample.json'), join(TMP, 'public/game-data/questions.sample.json'))
if (existsSync(join(ROOT, 'game-content/questions.json'))) copyFileSync(join(ROOT, 'game-content/questions.json'), join(TMP, 'public/game-data/questions.local.json'))
else console.warn('[경고] game-content/questions.json 이 없어 테스트 샘플 문제로 만듭니다.')
for (const f of ['tsconfig.json', 'postcss.config.mjs']) copyFileSync(join(ROOT, f), join(TMP, f))
copyFileSync(join(ROOT, 'src/app/globals.css'), join(TMP, 'src/app/globals.css'))
writeFileSync(join(TMP, 'package.json'), JSON.stringify({ name: 'student-pack', private: true, version: '0.0.0' }, null, 1))

// 2) 게임이 첫 화면인 최소 앱 + 정적 내보내기 설정
writeFileSync(join(TMP, 'next.config.ts'), `import type { NextConfig } from 'next'\nconst c: NextConfig = { output: 'export', images: { unoptimized: true }, trailingSlash: false }\nexport default c\n`)
writeFileSync(join(TMP, 'src/app/layout.tsx'), `import type { Metadata, Viewport } from 'next'
import './globals.css'
export const metadata: Metadata = { title: '노량진 형사법 헌터 (테스트)', description: '형사소송법 OX 학습게임 테스트 버전' }
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body className="antialiased">{children}</body></html>
}
`)
writeFileSync(join(TMP, 'src/app/page.tsx'), `import GameClient from '@/components/game/GameClient'\nexport default function Page() { return <GameClient /> }\n`)

// 3) 빌드 (의존 패키지는 저장소의 node_modules 를 그대로 사용)
symlinkSync(join(ROOT, 'node_modules'), join(TMP, 'node_modules'), 'dir')
execFileSync('npx', ['next', 'build'], { cwd: TMP, stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_STUDENT: '1' } })

// 4) 패키지 조립
cpSync(join(TMP, 'out'), join(PACK, 'site'), { recursive: true })
for (const f of ['server.ps1', 'start-windows.bat', 'start-mac.command', 'README.txt']) copyFileSync(join(ROOT, 'scripts/student-pack', f), join(PACK, f))
rmSync(TMP, { recursive: true, force: true })

// 5) zip
const zip = join(DIST, 'noryangjin-hunter-student-test.zip')
rmSync(zip, { force: true })
execFileSync('python3', ['-I', '-c', `
import zipfile, os, sys
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, fs in os.walk(src):
        for f in fs:
            p = os.path.join(d, f); arc = os.path.join('noryangjin-hunter-test', os.path.relpath(p, src))
            zi = zipfile.ZipInfo.from_file(p, arc)
            if f.endswith('.command'): zi.external_attr = 0o755 << 16  # 맥에서 바로 실행 가능
            z.writestr(zi, open(p, 'rb').read(), zipfile.ZIP_DEFLATED)
`, PACK, zip], { stdio: 'inherit' })
console.log('완료:', zip, Math.round(readFileSync(zip).length / 1024 / 1024 * 10) / 10 + 'MB')
