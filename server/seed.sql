-- Basit örnek veri
INSERT INTO cafes (name) VALUES ('Kafe Demo') ON CONFLICT DO NOTHING;

-- Kafe id'sini al
WITH c AS (
  SELECT id FROM cafes WHERE name='Kafe Demo' LIMIT 1
)
INSERT INTO tables (cafe_id, code, qr_token)
SELECT c.id, v.code, v.qr_token FROM c,
(VALUES
 ('A1','TABLE-A1-TOKEN'),
 ('A2','TABLE-A2-TOKEN'),
 ('A3','TABLE-A3-TOKEN'),
 ('A4','TABLE-A4-TOKEN'),
 ('A5','TABLE-A5-TOKEN')
) AS v(code, qr_token)
ON CONFLICT DO NOTHING;
