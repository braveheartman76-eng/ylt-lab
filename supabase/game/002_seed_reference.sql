-- 참조 데이터 시드 (과목/아이템). 실제 문제 내용은 포함하지 않는다.
INSERT INTO game_subjects(id,name,sort_order) VALUES
  ('criminal_law','형법',1),
  ('criminal_procedure','형사소송법',2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO game_items(id,name,tier,slot,price_coins) VALUES
  ('pencil','연필','basic','desk',10),
  ('highlighter','형광펜','basic','desk',15),
  ('notebook','공책','basic','desk',20),
  ('textbook','기본서','basic','desk',40),
  ('bag','책가방','basic','bag',30),
  ('desk','책상','mid','room',120),
  ('stand','스탠드','mid','room',100),
  ('bookshelf','책장','mid','room',150),
  ('wrong_note','오답노트','mid','desk',80),
  ('reading_seat','독서실 좌석','mid','room',200),
  ('tablet','태블릿','high','desk',400),
  ('premium_book','전문 수험서','high','desk',300),
  ('premium_reading_room','고급 독서실','high','room',600),
  ('mock_materials','모의고사 자료','high','desk',250),
  ('outfit_final','파이널 의상','high','outfit',500)
ON CONFLICT (id) DO NOTHING;
