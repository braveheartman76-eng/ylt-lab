import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';

const SUBJECTS = ['형사소송법', '형법', '노동법', '교정학', '행정법'];
const MAX_TEXT_LENGTH = 25000;

async function parsePDF(buffer: ArrayBuffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

async function parseHWPX(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);

  const sectionFiles = Object.keys(zip.files)
    .filter(name => /^Contents\/section\d+\.xml$/i.test(name))
    .sort();

  if (sectionFiles.length === 0) {
    throw new Error('HWPX 파일 구조를 인식할 수 없습니다. 올바른 hwpx 파일인지 확인해주세요.');
  }

  const parts: string[] = [];
  for (const filename of sectionFiles) {
    const xml = await zip.files[filename].async('string');

    // hp:t 태그에서 텍스트 추출
    const matches = [...xml.matchAll(/<hp:t[^>]*>([^<]*)<\/hp:t>/g)];
    if (matches.length > 0) {
      parts.push(matches.map(m => m[1]).join(' '));
    } else {
      // fallback: 모든 XML 태그 제거
      parts.push(
        xml
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, ' ')
          .trim()
      );
    }
  }

  return parts.join('\n');
}

function buildPrompt(text: string, mode: string, subject?: string): string {
  const body =
    text.length > MAX_TEXT_LENGTH
      ? text.slice(0, MAX_TEXT_LENGTH) + '\n\n[내용이 너무 길어 일부 생략됨]'
      : text;

  if (mode === 'korean') {
    return `당신은 한국어 맞춤법 전문 교정자입니다. 아래 텍스트에서 오탈자, 띄어쓰기 오류, 맞춤법 오류를 찾아주세요.

[검수 텍스트]
${body}

반드시 아래 JSON 형식으로만 응답하세요. 설명 텍스트 없이 JSON만 출력하세요:
{
  "errors": [
    {
      "id": 1,
      "type": "오탈자",
      "original": "오류가 있는 원본 구절",
      "corrected": "수정된 구절",
      "location": "위치 설명 (예: 1번째 단락 2번째 문장)",
      "explanation": "오류 상세 설명"
    }
  ],
  "summary": {
    "total": 0,
    "byType": {
      "오탈자": 0,
      "띄어쓰기": 0,
      "맞춤법": 0
    }
  }
}

type은 "오탈자", "띄어쓰기", "맞춤법" 중 하나여야 합니다.
오류가 없으면 errors를 빈 배열로, total을 0으로 반환하세요.`;
  }

  return `당신은 ${subject} 전문 법학 교수이자 시험 문제 오류 검수 전문가입니다. 아래 텍스트는 ${subject} 시험 문제입니다.
객관식과 OX 문제에서 법리적 오류, 답안 오류, 선지 오류, 문제 자체 오류를 정밀하게 검수해주세요.

[검수 텍스트]
${body}

반드시 아래 JSON 형식으로만 응답하세요. 설명 텍스트 없이 JSON만 출력하세요:
{
  "errors": [
    {
      "id": 1,
      "type": "답안오류",
      "questionNumber": "3번",
      "original": "오류가 있는 원본 내용",
      "corrected": "올바른 내용",
      "explanation": "오류 설명 및 관련 법령·판례 근거"
    }
  ],
  "summary": {
    "total": 0,
    "byType": {
      "답안오류": 0,
      "법리오류": 0,
      "문제오류": 0,
      "지문오류": 0
    }
  }
}

type은 "답안오류", "법리오류", "문제오류", "지문오류" 중 하나여야 합니다.
오류가 없으면 errors를 빈 배열로, total을 0으로 반환하세요.`;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const mode = formData.get('mode') as string | null;
    const subject = formData.get('subject') as string | null;

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
    }
    if (!mode || !['korean', 'legal'].includes(mode)) {
      return NextResponse.json({ error: '검수 모드를 선택해주세요.' }, { status: 400 });
    }
    if (mode === 'legal' && (!subject || !SUBJECTS.includes(subject))) {
      return NextResponse.json({ error: '올바른 과목을 선택해주세요.' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다. .env.local에 키를 추가해주세요.' },
        { status: 500 }
      );
    }

    const buffer = await file.arrayBuffer();
    const name = file.name.toLowerCase();

    let text: string;
    if (name.endsWith('.pdf')) {
      text = await parsePDF(buffer);
    } else if (name.endsWith('.hwpx')) {
      text = await parseHWPX(buffer);
    } else {
      return NextResponse.json({ error: 'hwpx 또는 pdf 파일만 지원합니다.' }, { status: 400 });
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: '파일에서 텍스트를 추출할 수 없습니다. 스캔 이미지 PDF는 지원하지 않습니다.' },
        { status: 400 }
      );
    }

    const client = new Anthropic({ apiKey });
    const prompt = buildPrompt(text, mode, subject ?? undefined);

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText =
      message.content[0].type === 'text' ? message.content[0].text : '';

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'API 응답을 파싱할 수 없습니다.' }, { status: 500 });
    }

    const result = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ success: true, mode, subject, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
