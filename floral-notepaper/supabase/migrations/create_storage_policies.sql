-- ============================================
-- chat-files Storage 策略
-- 路径格式: {conversation_id}/{timestamp}_{filename}
-- ============================================

-- 先删除用户可能手动创建的重复策略
DROP POLICY IF EXISTS "Users can view their conversation files" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload files to their conversations" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their conversation files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their conversation files" ON storage.objects;

-- SELECT: 仅会话成员可查看文件
CREATE POLICY "Members can view conversation files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'chat-files'
  AND auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = (storage.foldername(name))[1]::uuid
    AND user_id = auth.uid()
  )
);

-- INSERT: 仅会话成员可上传文件
CREATE POLICY "Members can upload to conversations"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'chat-files'
  AND auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = (storage.foldername(name))[1]::uuid
    AND user_id = auth.uid()
  )
);

-- UPDATE: 会话成员可更新文件
CREATE POLICY "Members can update conversation files"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'chat-files'
  AND auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = (storage.foldername(name))[1]::uuid
    AND user_id = auth.uid()
  )
);

-- DELETE: 会话成员可删除文件
CREATE POLICY "Members can delete conversation files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'chat-files'
  AND auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = (storage.foldername(name))[1]::uuid
    AND user_id = auth.uid()
  )
);
